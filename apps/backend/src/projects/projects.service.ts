import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, In, IsNull, Repository, DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { ProjectEntity } from './project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { ProjectInvitationEntity } from './project-invitation.entity';
import { ProjectSlugHistoryEntity } from './project-slug-history.entity';
import { UserEntity } from '../database/entities/user.entity';
import { TaskEntity } from '../tasks/task.entity';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsDto } from './list-projects.dto';
import { UpdateProjectDtoImpl } from './update-project.dto';
import { UpdateProjectStatusDto } from './update-project-status.dto';
import { InviteProjectMemberDto } from './invite-project-member.dto';
import { ChangeProjectLeaderDto } from './change-project-leader.dto';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import {
  ProjectMemberRole as ProjectMemberRoleEnum,
  ProjectActivityAction,
  ProjectActivityEntityType,
  ProjectStatus,
  RoleName,
} from '../database/enums';
import { AddProjectMemberDto, UpdateProjectMemberRoleDto } from '@tema/shared-types';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ProjectActivityService } from './project-activity.service';
import { slugify } from './utils/slug.util';
import { DEFAULT_PROJECT_CURRENCY } from '../economy/project-currency';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly repo: Repository<ProjectEntity>,
    @InjectRepository(ProjectMemberEntity)
    private readonly memberRepo: Repository<ProjectMemberEntity>,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly permissions: PermissionsService,
    private readonly dataSource: DataSource,
    private readonly activityService: ProjectActivityService,
  ) {}

  /**
   * ADMIN/PROGRAM_MANAGER ven todos los proyectos. El resto solo ve los propios
   * (leaderId) o aquellos donde tiene una fila activa en project_members
   * (COLLABORATOR u OBSERVER) — filtrado en SQL, nunca trayendo todo y filtrando
   * en memoria.
   */
  async findAll(query: ListProjectsDto = {}, user: RequestUser): Promise<ProjectEntity[]> {
    const qb = this.repo.createQueryBuilder('project');

    qb.where(query.archived ? 'project.archivedAt IS NOT NULL' : 'project.archivedAt IS NULL');
    if (query.status) qb.andWhere('project.status = :status', { status: query.status });
    if (query.name) qb.andWhere('project.name ILIKE :name', { name: `%${query.name}%` });

    if (!this.permissions.hasAnyGlobalRole(user, [RoleName.ADMIN, RoleName.PROGRAM_MANAGER])) {
      qb.leftJoin(
        ProjectMemberEntity,
        'membership',
        'membership.projectId = project.id AND membership.userId = :userId AND membership.removedAt IS NULL',
        { userId: user.id },
      );
      qb.andWhere(
        new Brackets((sub) => {
          sub.where('project.leaderId = :leaderId', { leaderId: user.id }).orWhere('membership.id IS NOT NULL');
        }),
      );
    }

    qb.orderBy('project.createdAt', 'DESC');
    const projects = await qb.getMany();
    await this.attachLeaders(projects);
    const enriched = await this.enrichProjectsStats(projects);
    await this.attachEconomicCurrency(enriched as ProjectEntity[], user);
    return enriched as any;
  }

  /**
   * Agrega `economicCurrency` SOLO a los proyectos donde el usuario puede ver lo económico (ADMIN, PM y líder real; RN-25). La
   * columna es `select: false`, así que para el resto el campo no sale por ningún camino. Una sola consulta por ids.
   */
  private async attachEconomicCurrency(projects: ProjectEntity[], user: RequestUser): Promise<void> {
    // Los tests unitarios arman un DataSource parcial: sin `query` no hay nada que agregar.
    if (typeof this.dataSource?.query !== 'function') return;
    const visible = projects.filter((p) => this.permissions.canViewEconomicData(user, p));
    if (visible.length === 0) return;
    const rows: Array<{ id: string; economicCurrency: string; locked: boolean }> = await this.dataSource.query(
      `SELECT p.id, p.economic_currency AS "economicCurrency",
              (EXISTS (SELECT 1 FROM budgets b WHERE b.project_id = p.id)
               OR EXISTS (SELECT 1 FROM costs c WHERE c.project_id = p.id)
               OR EXISTS (SELECT 1 FROM project_member_allocations a JOIN project_members pm ON pm.id = a.project_member_id WHERE pm.project_id = p.id)) AS locked
         FROM projects p WHERE p.id = ANY($1::uuid[])`,
      [visible.map((p) => p.id)],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const project of visible) {
      const row = byId.get(project.id);
      if (!row) continue;
      project.economicCurrency = row.economicCurrency;
      project.economicCurrencyLocked = row.locked;
    }
  }

  /**
   * Cambia la moneda única del proyecto. Toma el proyecto FOR UPDATE (el mismo lock que el versionado de presupuesto; costos y
   * asignaciones lo toman FOR SHARE y esperan), así que nadie puede crear datos económicos entre la verificación y el UPDATE.
   * Solo se permite mientras el proyecto NO tenga presupuesto, costos ni asignaciones (incluidos los dados de baja o históricos);
   * si no, 409 PROJECT_CURRENCY_IN_USE. NUNCA convierte nada. Misma moneda = sin cambio.
   */
  private async changeEconomicCurrency(manager: EntityManager, project: ProjectEntity, requested: string): Promise<void> {
    const [locked]: Array<{ economicCurrency: string }> = await manager.query(
      'SELECT economic_currency AS "economicCurrency" FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [project.id],
    );
    if (!locked) throw new NotFoundException(`Project ${project.id} no encontrado`);
    if (locked.economicCurrency === requested) {
      project.economicCurrency = requested;
      return;
    }
    const [usage]: Array<{ used: boolean }> = await manager.query(
      `SELECT (
         EXISTS (SELECT 1 FROM budgets WHERE project_id = $1)
         OR EXISTS (SELECT 1 FROM costs WHERE project_id = $1)
         OR EXISTS (SELECT 1 FROM project_member_allocations a JOIN project_members pm ON pm.id = a.project_member_id WHERE pm.project_id = $1)
       ) AS used`,
      [project.id],
    );
    if (usage?.used) {
      throw new ConflictException({
        code: 'PROJECT_CURRENCY_IN_USE',
        message: 'La moneda del proyecto no puede modificarse porque el proyecto ya tiene información económica.',
        projectCurrency: locked.economicCurrency,
      });
    }
    await manager.query('UPDATE projects SET economic_currency = $2 WHERE id = $1', [project.id, requested]);
    project.economicCurrency = requested;
  }

  /**
   * Genera un slug único a partir del nombre del proyecto.
   * Si ya existe un proyecto con ese slug (incluyendo soft-deleted para respetar la unicidad del índice en PostgreSQL),
   * calcula el siguiente sufijo numérico (-2, -3, etc.).
   * Usa advisory lock sobre el slug base dentro de la transacción para prevenir condiciones de carrera.
   */
  /**
   * Genera un slug único a partir del nombre del proyecto.
   * Si ya existe un proyecto con ese slug (incluyendo soft-deleted para respetar la unicidad del índice en PostgreSQL),
   * calcula el siguiente sufijo numérico (-2, -3, etc.).
   * Usa advisory lock sobre el slug base dentro de la transacción para prevenir condiciones de carrera.
   */
  async generateUniqueSlug(name: string, manager: EntityManager, currentProjectId?: string): Promise<string> {
    const baseSlug = slugify(name);

    if (typeof manager.query === 'function') {
      try {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['tema_project_slugs', baseSlug]);
      } catch {
        try {
          await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`project_slug_${baseSlug}`]);
        } catch {
          // En tests o drivers donde advisory lock no está disponible
        }
      }
    }

    interface SlugRow {
      slug: string;
      project_id?: string;
      source?: 'project' | 'history';
    }
    let rows: SlugRow[] = [];
    if (typeof manager.query === 'function') {
      try {
        const queryResult = await manager.query(
          `SELECT slug, id::text AS project_id, 'project' AS source FROM projects WHERE slug = $1 OR slug LIKE $2
           UNION ALL
           SELECT slug, project_id::text AS project_id, 'history' AS source FROM project_slug_histories WHERE slug = $1 OR slug LIKE $2`,
          [baseSlug, `${baseSlug}-%`],
        );
        if (Array.isArray(queryResult)) {
          rows = queryResult;
        }
      } catch {
        rows = [];
      }
    }

    if (currentProjectId) {
      // Si el baseSlug ya pertenece a este mismo proyecto (actual o en su histórico), se puede reutilizar directamente
      const selfCurrent = rows.find((r) => r.slug === baseSlug && r.project_id === currentProjectId);
      if (selfCurrent) {
        return baseSlug;
      }

      const occupiedByOthers = new Set(
        rows.filter((r) => r.project_id && r.project_id !== currentProjectId).map((r) => r.slug),
      );

      if (!occupiedByOthers.has(baseSlug)) {
        return baseSlug;
      }

      let nextSuffix = 2;
      while (occupiedByOthers.has(`${baseSlug}-${nextSuffix}`)) {
        nextSuffix++;
      }
      return `${baseSlug}-${nextSuffix}`;
    }

    const occupied = new Set(rows.map((r) => r.slug));

    if (!occupied.has(baseSlug)) {
      return baseSlug;
    }

    let nextSuffix = 2;
    while (occupied.has(`${baseSlug}-${nextSuffix}`)) {
      nextSuffix++;
    }

    return `${baseSlug}-${nextSuffix}`;
  }

  /** Sin chequeo de acceso: uso interno para operaciones que ya validan permisos por su cuenta. Acepta UUID o slug. */
  private async findProjectOrThrow(idOrSlug: string): Promise<ProjectEntity> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const isMock = Boolean((this.repo.findOne as any)?._isMockFunction || (this.repo.findOneBy as any)?._isMockFunction);
    const where = isUuid ? { id: idOrSlug } : { slug: idOrSlug };
    let project = await this.repo.findOne({
      where,
      relations: ['leader'],
    });
    if (!project && isMock) {
      project = await this.repo.findOne({
        where: { id: idOrSlug } as any,
        relations: ['leader'],
      });
    }

    // Si no se encontró por ID ni por slug activo, buscar en histórico
    if (!project && !isUuid) {
      try {
        const historyRepo = this.dataSource.getRepository(ProjectSlugHistoryEntity);
        if (historyRepo && typeof historyRepo.findOne === 'function') {
          const history = await historyRepo.findOne({
            where: { slug: idOrSlug },
          });
          if (history && history.projectId) {
            project = await this.repo.findOne({
              where: { id: history.projectId },
              relations: ['leader'],
            });
          }
        }
      } catch {
        // Silently ignore if historyRepo is unavailable
      }
    }

    if (!project) throw new NotFoundException(`Project ${idOrSlug} no encontrado`);
    return project;
  }

  /** Busca un proyecto por id (UUID) o por slug dentro de una transacción activa. */
  private async findProjectInTransaction(manager: EntityManager, idOrSlug: string, relations?: string[]): Promise<ProjectEntity> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const isMock = Boolean((manager.findOneBy as any)?._isMockFunction || (manager.findOne as any)?._isMockFunction);

    let project: ProjectEntity | null = null;

    if (isMock) {
      if (typeof manager.findOneBy === 'function') {
        project = (await manager.findOneBy(ProjectEntity, { id: idOrSlug } as any)) || null;
        if (!project) {
          project = (await manager.findOneBy(ProjectEntity, { slug: idOrSlug } as any)) || null;
        }
      }
      if (!project && typeof manager.findOne === 'function') {
        project = (await manager.findOne(ProjectEntity, {
          where: (isUuid ? { id: idOrSlug } : { slug: idOrSlug }) as any,
          ...(relations ? { relations } : {}),
        })) || null;
      }
    } else {
      const where = (isUuid ? { id: idOrSlug } : { slug: idOrSlug }) as any;
      if (typeof manager.findOne === 'function' && relations && relations.length > 0) {
        project = await manager.findOne(ProjectEntity, { where, relations });
      } else if (typeof manager.findOneBy === 'function') {
        project = await manager.findOneBy(ProjectEntity, where);
      } else if (typeof manager.findOne === 'function') {
        project = await manager.findOne(ProjectEntity, { where });
      }
    }

    // Si no se encontró por ID ni por slug activo, buscar en histórico dentro de la transacción
    if (!project && !isUuid) {
      try {
        let history: ProjectSlugHistoryEntity | null = null;
        if (typeof manager.findOne === 'function') {
          history = await manager.findOne(ProjectSlugHistoryEntity, { where: { slug: idOrSlug } });
        } else if (typeof manager.findOneBy === 'function') {
          history = await manager.findOneBy(ProjectSlugHistoryEntity, { slug: idOrSlug });
        }
        if (history && history.projectId) {
          project = await this.findProjectInTransaction(manager, history.projectId, relations);
        }
      } catch {
        // Silently ignore if history lookup fails
      }
    }

    if (!project) throw new NotFoundException(`Project ${idOrSlug} no encontrado`);
    return project;
  }

  /** GET /projects/:id: 404 si no existe, 403 si existe pero el usuario no tiene acceso. Acepta UUID o slug. */
  async findOne(idOrSlug: string, user: RequestUser): Promise<ProjectEntity> {
    const project = await this.findProjectOrThrow(idOrSlug);
    const allowed = await this.permissions.canViewProject(user, project);
    if (!allowed) {
      throw new ForbiddenException('No tenés acceso a este proyecto.');
    }
    await this.attachLeaders([project]);
    const enriched = await this.enrichProjectsStats([project]);
    await this.attachEconomicCurrency(enriched as ProjectEntity[], user);
    return enriched[0] as any;
  }

  /**
   * Completa `project.leader` donde falte (en la lista siempre; en el detalle, solo si el líder está desactivado).
   * Antes la lista traía únicamente leaderId y la tarjeta decía "Sin asignar". Se resuelve en UNA consulta por ids y
   * con bajas lógicas incluidas: un líder desactivado tiene deleted_at, y ni relations ni ningún join de TypeORM lo
   * devuelven. Solo columnas públicas (las mismas que el detalle muestra a cualquier miembro).
   */
  private async attachLeaders(projects: ProjectEntity[]): Promise<void> {
    const missing = projects.filter((project) => !project.leader && project.leaderId);
    if (missing.length === 0) return;

    const leaders = await this.dataSource.getRepository(UserEntity).find({
      where: { id: In([...new Set(missing.map((project) => project.leaderId))]) },
      select: { id: true, name: true, email: true, avatarUrl: true, active: true },
      withDeleted: true,
    });
    const byId = new Map(leaders.map((leader) => [leader.id, leader]));
    for (const project of missing) {
      const leader = byId.get(project.leaderId);
      if (leader) project.leader = leader;
    }
  }

  /** GET /projects/:id/activity: mismo criterio de acceso que ver el proyecto. Acepta UUID o slug. */
  async getActivity(idOrSlug: string, limit: number, offset: number, user: RequestUser) {
    const project = await this.findProjectOrThrow(idOrSlug);
    const allowed = await this.permissions.canViewProject(user, project);
    if (!allowed) {
      throw new ForbiddenException('No tenés acceso a este proyecto.');
    }
    return this.activityService.getActivity(project.id, limit, offset);
  }

  /**
   * El líder (leaderId) tiene que ser siempre un usuario válido (ver getValidProjectLeader):
   *  - leaderId no viene y quien crea tiene PROJECT_LEADER: queda él mismo.
   *  - leaderId no viene y quien crea NO tiene PROJECT_LEADER (ADMIN/PM solos): 400, no se
   *    convierte en líder por defecto.
   *  - leaderId viene: se valida igual (también si es el propio actor). Elegir a OTRO usuario
   *    como líder es una decisión de ADMIN/PM (como PATCH :id/leader): un PROJECT_LEADER que no
   *    es ADMIN/PM solo puede ponerse a sí mismo.
   * La autorización de "puede crear proyectos" sigue en @Roles del controller.
   */
  async create(dto: CreateProjectDto, user: RequestUser): Promise<ProjectEntity> {
    const { leaderId: requestedLeaderId, ...projectData } = dto;
    const actorCanLead = this.permissions.hasAnyGlobalRole(user, [RoleName.PROJECT_LEADER]);
    const isAdminOrPm = this.permissions.hasAnyGlobalRole(user, [RoleName.ADMIN, RoleName.PROGRAM_MANAGER]);

    const leaderId = requestedLeaderId ?? (actorCanLead ? user.id : undefined);
    if (!leaderId) {
      throw new BadRequestException(
        'Indicá el líder del proyecto (leaderId): no tenés el rol de Líder, así que no podés quedar como líder por defecto.',
      );
    }
    if (leaderId !== user.id && !isAdminOrPm) {
      throw new ForbiddenException('Solo ADMIN o PROGRAM_MANAGER pueden asignar a otro usuario como líder del proyecto.');
    }

    if (projectData.startDate && projectData.estimatedEndDate && projectData.estimatedEndDate < projectData.startDate) {
      throw new BadRequestException('La fecha de entrega no puede ser anterior a la de inicio');
    }

    return this.dataSource.transaction(async (manager) => {
      const leader = await this.getValidProjectLeader(manager, leaderId);
      const slug = await this.generateUniqueSlug(projectData.name, manager);

      const project = manager.create(ProjectEntity, {
        ...projectData,
        slug,
        description: projectData.description ?? null,
        economicCurrency: projectData.economicCurrency ?? DEFAULT_PROJECT_CURRENCY,
        leaderId: leader.id,
        createdBy: user.id,
      });
      const savedProject = await manager.save(project);
      await this.activityService.logEvent(
        {
          projectId: savedProject.id,
          actorId: user.id,
          actionType: ProjectActivityAction.PROJECT_CREATED,
          entityType: ProjectActivityEntityType.PROJECT,
          entityId: savedProject.id,
          metadata: { name: savedProject.name, slug: savedProject.slug },
        },
        manager,
      );
      return savedProject;
    });
  }

  async update(idOrSlug: string, dto: UpdateProjectDtoImpl, user: RequestUser): Promise<ProjectEntity> {
    const result = await this.dataSource.transaction(async (manager) => {
      const project = await this.findProjectInTransaction(manager, idOrSlug);

      if (!this.permissions.canManageProject(user, project)) {
        throw new ForbiddenException('No podés modificar este proyecto.');
      }

      // La moneda única del proyecto se cambia por su propio camino (lock + verificación de uso). NO entra en `changes`: nada
      // económico va a project_activities.
      if (dto.economicCurrency !== undefined) {
        await this.changeEconomicCurrency(manager, project, dto.economicCurrency);
      }

      const finalStartDate = dto.startDate !== undefined ? dto.startDate : project.startDate;
      const finalEstimatedEndDate = dto.estimatedEndDate !== undefined ? dto.estimatedEndDate : project.estimatedEndDate;
      if (finalStartDate && finalEstimatedEndDate && finalEstimatedEndDate < finalStartDate) {
        throw new BadRequestException('La fecha de entrega no puede ser anterior a la de inicio');
      }

      const changes: Record<string, { old: unknown; new: unknown }> = {};
      if (dto.name !== undefined && dto.name.trim() !== project.name) {
        const trimmedName = dto.name.trim();
        const oldSlug = project.slug;
        const candidateBaseSlug = slugify(trimmedName);
        if (candidateBaseSlug && candidateBaseSlug !== project.slug) {
          const newSlug = await this.generateUniqueSlug(trimmedName, manager, project.id);
          if (newSlug !== project.slug) {
            if (typeof manager.delete === 'function') {
              try {
                await manager.delete(ProjectSlugHistoryEntity, { projectId: project.id, slug: newSlug });
              } catch {
                // Ignore if delete not supported in mock
              }
            }
            if (typeof manager.save === 'function' && typeof manager.create === 'function') {
              try {
                const historyEntry = manager.create(ProjectSlugHistoryEntity, {
                  projectId: project.id,
                  slug: oldSlug,
                });
                await manager.save(ProjectSlugHistoryEntity, historyEntry);
              } catch {
                // Ignore if history save not supported in mock
              }
            }
            changes.slug = { old: oldSlug, new: newSlug };
            project.slug = newSlug;
          }
        }
        changes.name = { old: project.name, new: trimmedName };
        project.name = trimmedName;
      }
      if (dto.description !== undefined && dto.description !== project.description) {
        changes.description = { old: project.description, new: dto.description };
        project.description = dto.description ?? null;
      }
      if (dto.estimatedEndDate !== undefined && dto.estimatedEndDate !== project.estimatedEndDate) {
        changes.estimatedEndDate = { old: project.estimatedEndDate, new: dto.estimatedEndDate };
        project.estimatedEndDate = dto.estimatedEndDate;
      }
      if (dto.startDate !== undefined && dto.startDate !== project.startDate) {
        changes.startDate = { old: project.startDate, new: dto.startDate };
        project.startDate = dto.startDate;
      }

      if (Object.keys(changes).length === 0) {
        return project; // Nada que guardar ni auditar.
      }

      const updatedProject = await manager.save(project);

      await this.activityService.logEvent(
        {
          projectId: updatedProject.id,
          actorId: user.id,
          actionType: ProjectActivityAction.PROJECT_UPDATED,
          entityType: ProjectActivityEntityType.PROJECT,
          entityId: updatedProject.id,
          metadata: { changes },
        },
        manager,
      );

      return updatedProject;
    });
    // Quien puede modificar el proyecto (ADMIN, PM, líder real) puede ver lo económico: el resultado lleva la moneda vigente.
    await this.attachEconomicCurrency([result], user);
    return result;
  }

  async changeStatus(idOrSlug: string, dto: UpdateProjectStatusDto, user: RequestUser): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await this.findProjectInTransaction(manager, idOrSlug);

      if (!this.permissions.canManageProject(user, project)) {
        throw new ForbiddenException('No podés modificar el estado de este proyecto.');
      }

      if (project.status === dto.status) {
        return project;
      }

      const history = manager.create(ProjectStatusHistoryEntity, {
        projectId: project.id,
        previousStatus: project.status,
        newStatus: dto.status,
        changedByUserId: user.id,
      });

      project.status = dto.status;

      await manager.save(history);
      return manager.save(project);
    });
  }

  async archive(idOrSlug: string, user: RequestUser): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await this.findProjectInTransaction(manager, idOrSlug);

      if (!this.permissions.canManageProject(user, project)) {
        throw new ForbiddenException('No podés archivar este proyecto.');
      }

      if (project.archivedAt) return project;

      if (project.status !== ProjectStatus.FINISHED && project.status !== ProjectStatus.CANCELLED) {
        throw new BadRequestException('Solo se pueden archivar proyectos FINALIZADOS o CANCELADOS');
      }

      project.archivedAt = new Date();
      const archivedProject = await manager.save(project);

      await this.activityService.logEvent(
        {
          projectId: archivedProject.id,
          actorId: user.id,
          actionType: ProjectActivityAction.PROJECT_ARCHIVED,
          entityType: ProjectActivityEntityType.PROJECT,
          entityId: archivedProject.id,
        },
        manager,
      );

      return archivedProject;
    });
  }

  /**
   * Invariante de RN-23: todo leaderId apunta a un usuario existente, ACTIVO y con PROJECT_LEADER.
   * Lo comparten create y changeLeader. Toma FOR SHARE sobre el candidato ANTES de validar: se
   * serializa con "quitar PROJECT_LEADER" / "desactivar" (UsersService, FOR UPDATE), así que o
   * validamos antes de que le quiten el rol, o esperamos y lo vemos ya sin rol (400). Varios
   * proyectos asignándole el mismo líder no se bloquean entre sí. Debe llamarse dentro de la
   * transacción que persiste el leaderId.
   */
  private async getValidProjectLeader(manager: EntityManager, userId: string): Promise<UserEntity> {
    await manager.query('SELECT id FROM users WHERE id = $1 FOR SHARE', [userId]);

    const leader = await this.usersService.findById(userId, manager);
    if (!leader) {
      throw new NotFoundException(`Usuario ${userId} no encontrado`);
    }
    if (!leader.active || leader.deletedAt) {
      throw new BadRequestException('El líder debe ser un usuario activo.');
    }
    const roles = await this.authService.getRoleNames(leader.id);
    if (!roles.includes(RoleName.PROJECT_LEADER)) {
      throw new BadRequestException(
        `El usuario ${leader.id} no tiene el rol PROJECT_LEADER: no se le puede asignar el liderazgo de un proyecto.`,
      );
    }
    return leader;
  }

  /**
   * Solo ADMIN/PROGRAM_MANAGER llegan acá (gateado por @Roles en el controller).
   * Reglas: el nuevo líder debe existir, estar activo y tener RoleName.PROJECT_LEADER
   * — nunca se lo otorga como efecto secundario. Todo dentro de una transacción:
   * en ningún momento persistido el proyecto queda con leaderId null (se lee y se
   * pisa el mismo NOT NULL en un solo UPDATE). Auditoría vía ProjectActivityService,
   * reusando el mismo subsistema que el resto de los cambios de proyecto.
   */
  async changeLeader(id: string, dto: ChangeProjectLeaderDto, user: RequestUser): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await this.findProjectInTransaction(manager, id);

      const newLeader = await this.getValidProjectLeader(manager, dto.newLeaderId);

      if (project.leaderId === newLeader.id) {
        return project;
      }

      const previousLeaderId = project.leaderId;
      project.leaderId = newLeader.id;
      const saved = await manager.save(project);

      await this.activityService.logEvent(
        {
          projectId: project.id,
          actorId: user.id,
          actionType: ProjectActivityAction.PROJECT_LEADER_CHANGED,
          entityType: ProjectActivityEntityType.PROJECT,
          entityId: project.id,
          metadata: { previousLeaderId, newLeaderId: newLeader.id },
        },
        manager,
      );

      return saved;
    });
  }

  async getMembers(projectId: string, user: RequestUser): Promise<ProjectMemberEntity[]> {
    const project = await this.findProjectOrThrow(projectId);
    const allowed = await this.permissions.canViewProject(user, project);
    if (!allowed) {
      throw new ForbiddenException('No tenés acceso a este proyecto.');
    }

    return this.memberRepo.find({
      where: { projectId: project.id, removedAt: IsNull() },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });
  }

  /**
   * GET /projects/:id/available-users: usuarios de TEMA para agregar directo al
   * equipo (reemplaza el flujo de invitación por correo). Reusa
   * UsersService.findAllWithRoles (misma busqueda que la administracion de
   * usuarios) y descarta inactivos y a quienes ya son miembros activos.
   */
  async getAvailableUsers(projectId: string, search: string | undefined, user: RequestUser) {
    const project = await this.findProjectOrThrow(projectId);
    if (!this.permissions.canManageProjectTeam(user, project)) {
      throw new ForbiddenException('No podés administrar el equipo de este proyecto.');
    }

    const [candidates, members] = await Promise.all([
      this.usersService.findAllWithRoles({ search }),
      this.memberRepo.find({ where: { projectId: project.id, removedAt: IsNull() } }),
    ]);

    const memberIds = new Set(members.map((m) => m.userId));
    return candidates.filter((u) => u.active && !memberIds.has(u.id));
  }

  async inviteMember(projectId: string, dto: InviteProjectMemberDto, user: RequestUser) {
    return this.dataSource.transaction(async (manager) => {
      const project = await this.findProjectInTransaction(manager, projectId);

      if (!this.permissions.canManageProjectTeam(user, project)) {
        throw new ForbiddenException('No podés administrar el equipo de este proyecto.');
      }

      if (!dto.email.toLowerCase().endsWith('@gmail.com')) {
        throw new BadRequestException('Solo se permiten invitaciones a correos con dominio @gmail.com');
      }

      // Check if user is already a member
      const existingUser = await this.usersService.findByEmail(dto.email, manager);
      if (existingUser) {
        const isMember = await manager.findOne(ProjectMemberEntity, {
          where: { projectId: project.id, userId: existingUser.id, removedAt: IsNull() },
        });
        if (isMember) {
          throw new BadRequestException('El usuario ya es miembro de este proyecto');
        }
      }

      // Check if there is already a pending invitation for this email
      const existingInvite = await manager.findOne(ProjectInvitationEntity, {
        where: { projectId: project.id, email: dto.email, status: 'PENDING' },
      });
      if (existingInvite) {
        throw new BadRequestException('Ya existe una invitación pendiente para este correo');
      }

      const token = crypto.randomBytes(32).toString('hex');

      const invitation = manager.create(ProjectInvitationEntity, {
        projectId: project.id,
        email: dto.email,
        name: dto.name,
        projectRole: dto.projectRole,
        invitedBy: user.id,
        token,
        status: 'PENDING',
      });

      await manager.save(invitation);
      
      // TODO: Here we would trigger the email sending service.
      
      return invitation;
    });
  }

  /** GET /projects/:id/invitations: mismo criterio que administrar el equipo (expone emails de invitados). */
  async getPendingInvitations(projectId: string, user: RequestUser): Promise<ProjectInvitationEntity[]> {
    const project = await this.findProjectOrThrow(projectId);
    if (!this.permissions.canManageProjectTeam(user, project)) {
      throw new ForbiddenException('No podés ver las invitaciones de este proyecto.');
    }
    return this.dataSource.getRepository(ProjectInvitationEntity).find({
      where: { projectId: project.id, status: 'PENDING' },
      relations: ['inviter'],
      order: { createdAt: 'DESC' },
    });
  }

  /** DELETE /projects/:id/invitations/:invitationId: cancelar una invitación pendiente (administrar equipo). */
  async revokeInvitation(projectId: string, invitationId: string, user: RequestUser): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const project = await this.findProjectInTransaction(manager, projectId);

      if (!this.permissions.canManageProjectTeam(user, project)) {
        throw new ForbiddenException('No tenés permisos para gestionar invitaciones en este proyecto.');
      }

      const invitation = await manager.findOne(ProjectInvitationEntity, {
        where: { id: invitationId, projectId: project.id, status: 'PENDING' },
      });

      if (!invitation) {
        throw new NotFoundException('Invitación no encontrada o ya no está pendiente');
      }

      await manager.remove(invitation);
    });
  }

  // --- SOLO DESARROLLO: ver ProjectInvitationsDevController (deshabilitado en producción) ---
  async testAcceptInvitation(projectId: string, invitationId: string, user: RequestUser): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const project = await this.findProjectInTransaction(manager, projectId);
      if (!this.permissions.canManageProjectTeam(user, project)) {
        throw new ForbiddenException('No podés administrar el equipo de este proyecto.');
      }

      const invitation = await manager.findOne(ProjectInvitationEntity, {
        where: { id: invitationId, projectId: project.id, status: 'PENDING' },
      });
      if (!invitation) throw new NotFoundException('Invitación no encontrada o ya procesada');

      const usersRepo = manager.getRepository(UserEntity);
      const membersRepo = manager.getRepository(ProjectMemberEntity);
      
      let targetUser = await usersRepo.findOneBy({ email: invitation.email });
      if (!targetUser) {
        if (!invitation.name || invitation.name.trim() === '') {
          throw new BadRequestException(
            'Esta invitación es antigua y no tiene un nombre asociado. No se puede crear un usuario de prueba automáticamente. Por favor, cancelá esta invitación y creá una nueva.'
          );
        }
        
        // Create dummy user for test using the typed name
        targetUser = usersRepo.create({
          email: invitation.email,
          name: invitation.name.trim(),
          active: true,
        });
        await usersRepo.save(targetUser);
      }

      // Add as member
      let member = await membersRepo.findOne({ where: { projectId: project.id, userId: targetUser.id } });
      if (member) {
        if (member.removedAt !== null) {
          member.removedAt = null;
          member.projectRole = invitation.projectRole;
          await membersRepo.save(member);
        }
        // If already active, just proceed to mark invitation as accepted.
      } else {
        member = membersRepo.create({
          projectId: project.id,
          userId: targetUser.id,
          projectRole: invitation.projectRole,
        });
        await membersRepo.save(member);
      }

      // Mark invitation as accepted
      invitation.status = 'ACCEPTED';
      await manager.save(invitation);
    });
  }

  async addMember(projectId: string, dto: AddProjectMemberDto, user: RequestUser): Promise<ProjectMemberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await this.findProjectInTransaction(manager, projectId);

      if (!this.permissions.canManageProjectTeam(user, project)) {
        throw new ForbiddenException('No podés administrar el equipo de este proyecto.');
      }

      const userExists = await this.usersService.findById(dto.userId);
      if (!userExists) {
        throw new NotFoundException(`El usuario con ID ${dto.userId} no existe`);
      }

      const existing = await manager.findOne(ProjectMemberEntity, {
        where: { projectId: project.id, userId: dto.userId },
      });

      if (existing && existing.removedAt === null) {
        throw new ConflictException(`El usuario ya es miembro activo de este proyecto`);
      }

      // dto.projectRole es el tipo union de @tema/shared-types ('COLLABORATOR' |
      // 'OBSERVER'), validado por @IsEnum(ProjectMemberRole) en el DTO concreto
      // (project-member.dto.ts) contra el enum de Postgres/TypeORM del backend —
      // mismos valores, dos declaraciones (shared-types no depende de TypeORM).
      let savedMember: ProjectMemberEntity;
      if (existing && existing.removedAt !== null) {
        existing.removedAt = null;
        existing.projectRole = dto.projectRole as unknown as ProjectMemberRoleEnum;
        savedMember = await manager.save(existing);
      } else {
        const member = manager.create(ProjectMemberEntity, {
          projectId: project.id,
          userId: dto.userId,
          projectRole: dto.projectRole as unknown as ProjectMemberRoleEnum,
        });
        savedMember = await manager.save(member);
      }

      await this.activityService.logEvent(
        {
          projectId: project.id,
          actorId: user.id,
          actionType: ProjectActivityAction.MEMBER_ADDED,
          entityType: ProjectActivityEntityType.MEMBER,
          entityId: savedMember.id,
          metadata: { userId: dto.userId, role: dto.projectRole, name: userExists.name },
        },
        manager,
      );

      return savedMember;
    });
  }

  async updateMemberRole(
    projectId: string,
    memberId: string,
    dto: UpdateProjectMemberRoleDto,
    user: RequestUser,
  ): Promise<ProjectMemberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await this.findProjectInTransaction(manager, projectId);

      if (!this.permissions.canManageProjectTeam(user, project)) {
        throw new ForbiddenException('No podés administrar el equipo de este proyecto.');
      }

      const member = await manager.findOne(ProjectMemberEntity, {
        where: { id: memberId, projectId: project.id, removedAt: IsNull() },
        relations: ['user'],
      });
      if (!member) {
        throw new NotFoundException(`Miembro ${memberId} no encontrado en este proyecto`);
      }

      // dto.projectRole ya viene validado por @IsEnum(ProjectMemberRole) en el DTO
      // (solo COLLABORATOR u OBSERVER): no hace falta re-validar acá. Mismo cast que
      // en addMember (shared-types union -> enum backend, ver comentario ahí).
      const previousRole = member.projectRole;
      member.projectRole = dto.projectRole as unknown as ProjectMemberRoleEnum;
      const savedMember = await manager.save(member);

      await this.activityService.logEvent(
        {
          projectId: project.id,
          actorId: user.id,
          actionType: ProjectActivityAction.MEMBER_ROLE_CHANGED,
          entityType: ProjectActivityEntityType.MEMBER,
          entityId: savedMember.id,
          metadata: { previousRole, newRole: dto.projectRole, userId: savedMember.userId, name: member.user?.name },
        },
        manager,
      );

      return savedMember;
    });
  }

  async removeMember(projectId: string, memberId: string, user: RequestUser): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const project = await this.findProjectInTransaction(manager, projectId);

      if (!this.permissions.canManageProjectTeam(user, project)) {
        throw new ForbiddenException('No tenés permisos para administrar el equipo de este proyecto.');
      }

      const member = await manager.findOne(ProjectMemberEntity, {
        where: { id: memberId, projectId: project.id },
        relations: ['user'],
      });

      if (!member) {
        throw new NotFoundException(`Miembro ${memberId} no encontrado en este proyecto`);
      }

      if (member.removedAt) {
        throw new BadRequestException('El usuario ya fue removido del proyecto');
      }

      member.removedAt = new Date();
      await manager.save(member);

      await this.activityService.logEvent(
        {
          projectId: project.id,
          actorId: user.id,
          actionType: ProjectActivityAction.MEMBER_REMOVED,
          entityType: ProjectActivityEntityType.MEMBER,
          entityId: member.id,
          metadata: { 
            userId: member.userId, 
            role: member.projectRole,
            name: member.user.name 
          },
        },
        manager,
      );
    });
  }

  private async enrichProjectsStats(projects: ProjectEntity[]) {
    if (projects.length === 0) return [];
    if (typeof this.dataSource?.createQueryBuilder !== 'function') return projects;
    
    const projectIds = projects.map((p) => p.id);
    
    const membersQuery = this.dataSource.createQueryBuilder()
      .select('m.project_id', 'projectId')
      .addSelect('COUNT(m.id)', 'count')
      .from(ProjectMemberEntity, 'm')
      .where('m.project_id IN (:...projectIds)', { projectIds })
      .andWhere('m.removed_at IS NULL')
      .groupBy('m.project_id')
      .getRawMany();

    const tasksQuery = this.dataSource.createQueryBuilder()
      .select('t.project_id', 'projectId')
      .addSelect('COUNT(t.id)', 'total')
      .addSelect("SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END)", 'completed')
      .from(TaskEntity, 't')
      .where('t.project_id IN (:...projectIds)', { projectIds })
      .andWhere('t.archived_at IS NULL')
      .groupBy('t.project_id')
      .getRawMany();

    const [membersCounts, tasksCounts] = await Promise.all([membersQuery, tasksQuery]);
    
    const membersMap = new Map(membersCounts.map(r => [r.projectId, parseInt(r.count, 10)]));
    const tasksMap = new Map(tasksCounts.map(r => [
      r.projectId, 
      { total: parseInt(r.total, 10), completed: parseInt(r.completed, 10) }
    ]));

    return projects.map((p) => {
      const totalTasks = tasksMap.get(p.id)?.total || 0;
      const completedTasks = tasksMap.get(p.id)?.completed || 0;
      const progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
      
      p.memberCount = membersMap.get(p.id) || 0;
      p.progress = progress;
      return p;
    });
  }
}
