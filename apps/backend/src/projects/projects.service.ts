import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, IsNull, Repository, DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { ProjectEntity } from './project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { ProjectInvitationEntity } from './project-invitation.entity';
import { UserEntity } from '../database/entities/user.entity';
import { TaskEntity } from '../tasks/task.entity';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsDto } from './list-projects.dto';
import { InviteProjectMemberDto } from './invite-project-member.dto';
import { UpdateProjectDtoImpl } from './update-project.dto';
import { UpdateProjectStatusDto } from './update-project-status.dto';
import { InviteProjectMemberDtoImpl } from './invite-project-member.dto';
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
    return (await this.enrichProjectsStats(projects)) as any;
  }

  /** Sin chequeo de acceso: uso interno para operaciones que ya validan permisos por su cuenta. */
  private async findProjectOrThrow(id: string): Promise<ProjectEntity> {
    const project = await this.repo.findOne({
      where: { id },
      relations: ['leader'],
    });
    if (!project) throw new NotFoundException(`Project ${id} no encontrado`);
    return project;
  }

  /** GET /projects/:id: 404 si no existe, 403 si existe pero el usuario no tiene acceso. */
  async findOne(id: string, user: RequestUser): Promise<ProjectEntity> {
    const project = await this.findProjectOrThrow(id);
    const allowed = await this.permissions.canViewProject(user, project);
    if (!allowed) {
      throw new ForbiddenException('No tenés acceso a este proyecto.');
    }
    const enriched = await this.enrichProjectsStats([project]);
    return enriched[0] as any;
  }

  /** GET /projects/:id/activity: mismo criterio de acceso que ver el proyecto. */
  async getActivity(projectId: string, limit: number, offset: number, user: RequestUser) {
    const project = await this.findProjectOrThrow(projectId);
    const allowed = await this.permissions.canViewProject(user, project);
    if (!allowed) {
      throw new ForbiddenException('No tenés acceso a este proyecto.');
    }
    return this.activityService.getActivity(projectId, limit, offset);
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

    return this.dataSource.transaction(async (manager) => {
      const leader = await this.getValidProjectLeader(manager, leaderId);

      const project = manager.create(ProjectEntity, {
        ...projectData,
        description: projectData.description ?? null,
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
          metadata: { name: savedProject.name },
        },
        manager,
      );
      return savedProject;
    });
  }

  async update(id: string, dto: UpdateProjectDtoImpl, user: RequestUser): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOne(ProjectEntity, { where: { id } });
      if (!project) throw new NotFoundException(`Project ${id} no encontrado`);

      if (!this.permissions.canManageProject(user, project)) {
        throw new ForbiddenException('No podés modificar este proyecto.');
      }

      const changes: Record<string, { old: unknown; new: unknown }> = {};
      if (dto.name !== undefined && dto.name !== project.name) {
        changes.name = { old: project.name, new: dto.name };
        project.name = dto.name;
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
  }

  async changeStatus(id: string, dto: UpdateProjectStatusDto, user: RequestUser): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOneBy(ProjectEntity, { id });
      if (!project) throw new NotFoundException(`Project ${id} no encontrado`);

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

  async archive(id: string, user: RequestUser): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOneBy(ProjectEntity, { id });
      if (!project) throw new NotFoundException(`Project ${id} no encontrado`);

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
      const project = await manager.findOneBy(ProjectEntity, { id });
      if (!project) throw new NotFoundException(`Project ${id} no encontrado`);

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
      where: { projectId, removedAt: IsNull() },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });
  }

  async inviteMember(projectId: string, dto: InviteProjectMemberDtoImpl, user: RequestUser) {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOneBy(ProjectEntity, { id: projectId });
      if (!project) throw new NotFoundException(`Project ${projectId} no encontrado`);

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
          where: { projectId, userId: existingUser.id, removedAt: IsNull() },
        });
        if (isMember) {
          throw new BadRequestException('El usuario ya es miembro de este proyecto');
        }
      }

      // Check if there is already a pending invitation for this email
      const existingInvite = await manager.findOne(ProjectInvitationEntity, {
        where: { projectId, email: dto.email, status: 'PENDING' },
      });
      if (existingInvite) {
        throw new BadRequestException('Ya existe una invitación pendiente para este correo');
      }

      const token = crypto.randomBytes(32).toString('hex');

      const invitation = manager.create(ProjectInvitationEntity, {
        projectId,
        email: dto.email,
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
      where: { projectId, status: 'PENDING' },
      relations: ['inviter'],
      order: { createdAt: 'DESC' },
    });
  }

  // --- SOLO DESARROLLO: ver ProjectInvitationsDevController (deshabilitado en producción) ---
  async testAcceptInvitation(projectId: string, invitationId: string, user: RequestUser): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOneBy(ProjectEntity, { id: projectId });
      if (!project) throw new NotFoundException(`Project ${projectId} no encontrado`);
      if (!this.permissions.canManageProjectTeam(user, project)) {
        throw new ForbiddenException('No podés administrar el equipo de este proyecto.');
      }

      const invitation = await manager.findOne(ProjectInvitationEntity, {
        where: { id: invitationId, projectId, status: 'PENDING' },
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
      let member = await membersRepo.findOne({ where: { projectId, userId: targetUser.id } });
      if (member) {
        if (member.removedAt !== null) {
          member.removedAt = null;
          member.projectRole = invitation.projectRole;
          await membersRepo.save(member);
        }
        // If already active, just proceed to mark invitation as accepted.
      } else {
        member = membersRepo.create({
          projectId,
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
      const project = await manager.findOneBy(ProjectEntity, { id: projectId });
      if (!project) throw new NotFoundException(`Project ${projectId} no encontrado`);

      if (!this.permissions.canManageProjectTeam(user, project)) {
        throw new ForbiddenException('No podés administrar el equipo de este proyecto.');
      }

      const userExists = await this.usersService.findById(dto.userId);
      if (!userExists) {
        throw new NotFoundException(`El usuario con ID ${dto.userId} no existe`);
      }

      const existing = await manager.findOne(ProjectMemberEntity, {
        where: { projectId, userId: dto.userId },
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
          projectId,
          userId: dto.userId,
          projectRole: dto.projectRole as unknown as ProjectMemberRoleEnum,
        });
        savedMember = await manager.save(member);
      }

      await this.activityService.logEvent(
        {
          projectId,
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
      const project = await manager.findOneBy(ProjectEntity, { id: projectId });
      if (!project) throw new NotFoundException(`Project ${projectId} no encontrado`);

      if (!this.permissions.canManageProjectTeam(user, project)) {
        throw new ForbiddenException('No podés administrar el equipo de este proyecto.');
      }

      const member = await manager.findOne(ProjectMemberEntity, {
        where: { id: memberId, projectId, removedAt: IsNull() },
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
          projectId,
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
      const project = await manager.findOneBy(ProjectEntity, { id: projectId });
      if (!project) throw new NotFoundException(`Project ${projectId} no encontrado`);

      if (!this.permissions.canManageProjectTeam(user, project)) {
        throw new ForbiddenException('No tenés permisos para administrar el equipo de este proyecto.');
      }

      const member = await manager.findOne(ProjectMemberEntity, {
        where: { id: memberId, projectId },
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
          projectId,
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
