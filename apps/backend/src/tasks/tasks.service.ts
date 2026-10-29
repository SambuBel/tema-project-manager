import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository, EntityManager } from 'typeorm';
import { TaskEntity } from './task.entity';
import { TaskSlugHistoryEntity } from './task-slug-history.entity';
import { slugify } from '../projects/utils/slug.util';
import { SubtaskEntity } from '../subtasks/subtask.entity';
import { ProjectEntity } from '../projects/project.entity';
import { CommentEntity } from '../database/entities/comment.entity';
import { CommentMentionEntity } from '../database/entities/comment-mention.entity';
import { CommentMentionDto } from './dto/comment-mention.dto';
import { ProjectActivityService } from '../projects/project-activity.service';
import { AuditOrigin, ProjectActivityAction, ProjectActivityEntityType } from '../database/enums';
import { ProjectActivityEntity } from '../database/entities/project-activity.entity';
import { TaskPriority, TaskStatus } from '../database/enums';
import { UsersService } from '../users/users.service';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { syncMilestoneAutoCompletionWithManager } from '../milestones/milestone-auto-completion.helper';
import { FilterTasksDto } from './dto/filter-tasks.dto';
import { NotificationEventsService } from '../notifications/notification-events.service';

import {
  isValidTransition,
  TASK_STATUS_LABELS,
  VALID_TRANSITIONS,
} from './task-transitions';

/**
 * Toda decisión de AUTORIZACIÓN (quién puede ver/crear/editar/borrar) vive en
 * PermissionsService - este service ya no tiene su propia lógica de "es líder o
 * miembro". Lo único que queda acá son validaciones del DATO enviado, no de QUIEN pide la acción:
 * RN-03 (el responsable debe pertenecer al proyecto), la jerarquía de subtareas
 * y RN-04 (no completar con subtareas pendientes)
 */
/** Desde dónde viene un cambio. Sin esto se asume que lo hizo el usuario desde la app. */
export interface ChangeSource {
  origin: AuditOrigin;
  /** Pedido original del usuario cuando el cambio lo ejecutó el asistente. */
  request?: string;
}

const originOf = (source?: ChangeSource) => (source ? { origin: source.origin } : {});

function withSourceMetadata<T extends object>(metadata: T, source?: ChangeSource): T | (T & { viaAssistant: true; request?: string }) {
  if (source?.origin !== AuditOrigin.AI) return metadata;
  return { ...metadata, viaAssistant: true, request: source.request };
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(TaskEntity)
    private readonly repo: Repository<TaskEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(CommentEntity)
    private readonly commentRepo: Repository<CommentEntity>,
    @InjectRepository(CommentMentionEntity)
    private readonly commentMentionRepo: Repository<CommentMentionEntity>,
    private readonly usersService: UsersService,
    private readonly permissions: PermissionsService,
    private readonly activityService: ProjectActivityService,
    @InjectRepository(SubtaskEntity)
    private readonly subtaskRepo: Repository<SubtaskEntity>,
    @InjectRepository(TaskSlugHistoryEntity)
    private readonly taskSlugHistoryRepo: Repository<TaskSlugHistoryEntity>,
    @Optional() private readonly notificationEvents?: NotificationEventsService,
  ) {}

  /**
   * Genera un slug único para la tarea dentro de su proyecto.
   * Si ya existe una tarea o slug histórico con ese nombre en el proyecto, calcula el sufijo incremental (-2, -3, etc.).
   * Usa advisory lock por proyecto y baseSlug para evitar colisiones en creaciones simultáneas.
   */
  async generateUniqueSlug(
    title: string,
    projectId: string,
    manager: EntityManager,
    currentTaskId?: string,
  ): Promise<string> {
    const baseSlug = slugify(title, 'tarea');

    if (typeof manager.query === 'function') {
      try {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
          [`tema_task_slugs_${projectId}`, baseSlug],
        );
      } catch {
        try {
          await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`task_slug_${projectId}_${baseSlug}`]);
        } catch {
          // En tests o drivers donde advisory lock no está disponible
        }
      }
    }

    interface SlugRow {
      slug: string;
      task_id?: string;
      source?: 'task' | 'history';
    }
    let rows: SlugRow[] = [];
    if (typeof manager.query === 'function') {
      try {
        const queryResult = await manager.query(
          `SELECT slug, id::text AS task_id, 'task' AS source FROM tasks WHERE project_id = $1 AND (slug = $2 OR slug LIKE $3)
           UNION ALL
           SELECT slug, task_id::text AS task_id, 'history' AS source FROM task_slug_histories WHERE project_id = $1 AND (slug = $2 OR slug LIKE $3)`,
          [projectId, baseSlug, `${baseSlug}-%`],
        );
        if (Array.isArray(queryResult)) {
          rows = queryResult;
        }
      } catch {
        rows = [];
      }
    } else {
      const tasks = (await manager.find?.(TaskEntity, { where: { projectId } as any })) || [];
      const histories = (await manager.find?.(TaskSlugHistoryEntity, { where: { projectId } as any })) || [];
      rows = [
        ...tasks.map((t: any) => ({ slug: t.slug, task_id: t.id, source: 'task' as const })),
        ...histories.map((h: any) => ({ slug: h.slug, task_id: h.taskId, source: 'history' as const })),
      ].filter((r) => r.slug === baseSlug || r.slug?.startsWith(`${baseSlug}-`));
    }

    if (currentTaskId) {
      const selfCurrent = rows.find((r) => r.slug === baseSlug && r.task_id === currentTaskId);
      if (selfCurrent) {
        return baseSlug;
      }

      const occupiedByOthers = new Set(
        rows.filter((r) => r.task_id && r.task_id !== currentTaskId).map((r) => r.slug),
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

  private async findProjectOrThrow(projectId: string): Promise<ProjectEntity> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    return project;
  }

  /** Sin chequeo de autorización. Acepta UUID o slug dentro del proyecto (o buscando en su histórico). */
  private async findTaskOrThrow(idOrSlug: string, projectId?: string): Promise<TaskEntity> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    let task: TaskEntity | null = null;

    if (isUuid) {
      task = await this.repo.findOne({
        where: { id: idOrSlug },
        relations: ['project', 'assignedTo'],
      });
    } else {
      const where: any = { slug: idOrSlug };
      if (projectId) {
        where.projectId = projectId;
      }
      task = await this.repo.findOne({
        where,
        relations: ['project', 'assignedTo'],
      });

      if (!task) {
        const historyWhere: any = { slug: idOrSlug };
        if (projectId) {
          historyWhere.projectId = projectId;
        }
        const history = await this.taskSlugHistoryRepo.findOne({
          where: historyWhere,
          relations: ['task', 'task.project', 'task.assignedTo'],
        });
        if (history?.task) {
          task = history.task;
        }
      }
    }

    if (!task) {
      throw new NotFoundException(`Task ${idOrSlug} no encontrada`);
    }
    return task;
  }

  /**
   * RF-NO-01: se llama SIEMPRE fuera de la transacción. Un fallo de notificación
   * se loguea pero nunca rompe la creación/edición de la tarea.
   */
  private async notifyTaskAssigned(task: TaskEntity, user: RequestUser): Promise<void> {
    if (!this.notificationEvents || !task.assignedToId) return;

    try {
      const actorName =
        (user as any).name ?? (await this.usersService.findById(user.id))?.name ?? '';

      await this.notificationEvents.taskAssigned({
        task: { id: task.id, title: task.title, projectId: task.projectId },
        assigneeId: task.assignedToId,
        actorId: user.id,
        actorName,
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo enviar la notificación de asignación de la tarea ${task.id}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  private async assertAssigneeIsProjectMember(project: ProjectEntity, assigneeId: string): Promise<void> {
    const assignee = await this.usersService.findById(assigneeId);
    if (!assignee) {
      throw new NotFoundException(`El usuario responsable ${assigneeId} no existe`);
    }

    const isLeader = project.leaderId === assigneeId;
    const membership = isLeader ? null : await this.permissions.getProjectMembership(assigneeId, project.id);

    if (!isLeader && !membership) {
      throw new BadRequestException('El responsable debe ser miembro del proyecto');
    }
  }

  /**
   * Una subtarea tiene que apuntar a una tarea que exista, del MISMO proyecto, y que no
   * sea a su vez una subtarea.
   */
  private async assertValidParentTask(projectId: string, parentTaskId: string): Promise<void> {
    const parent = await this.repo.findOneBy({ id: parentTaskId });
    if (!parent) {
      throw new NotFoundException(`Task ${parentTaskId} no encontrada`);
    }
    if (parent.projectId !== projectId) {
      throw new BadRequestException('La tarea padre debe pertenecer al mismo proyecto');
    }
    if (parent.parentTaskId) {
      throw new BadRequestException('No se pueden anidar subtareas: la tarea padre ya es una subtarea');
    }
  }

  async create(dto: CreateTaskDto, user: RequestUser, source?: ChangeSource): Promise<TaskEntity> {
    const project = await this.findProjectOrThrow(dto.projectId);

    const allowed = await this.permissions.canCreateTask(user, project);
    if (!allowed) {
      throw new ForbiddenException('No podés crear tareas en este proyecto.');
    }

    if (dto.assignedToId) {
      await this.assertAssigneeIsProjectMember(project, dto.assignedToId);
    }

    if (dto.parentTaskId) {
      await this.assertValidParentTask(dto.projectId, dto.parentTaskId);
    }

    const created = await this.repo.manager.transaction(async (manager) => {
      const slug = await this.generateUniqueSlug(dto.title, project.id, manager);

      const task = new TaskEntity();
      task.projectId = dto.projectId;
      task.parentTaskId = dto.parentTaskId ?? null;
      task.title = dto.title;
      task.slug = slug;
      task.description = dto.description ?? null;
      task.status = dto.status ?? TaskStatus.PENDING;
      task.priority = dto.priority ?? TaskPriority.MEDIUM;
      task.assignedToId = dto.assignedToId ?? null;
      task.startDate = dto.startDate ?? null;
      task.dueDate = dto.dueDate ?? null;
      task.createdBy = user.id;

      const saved = await manager.save(TaskEntity, task);

      await this.activityService.logEvent(
        {
          projectId: saved.projectId,
          actorId: user.id,
          actionType: ProjectActivityAction.TASK_CREATED,
          entityType: ProjectActivityEntityType.TASK,
          entityId: saved.id,
          metadata: withSourceMetadata({ title: saved.title, slug: saved.slug }, source),
          ...originOf(source),
        },
        manager,
      );

      return saved;
    });

    await this.notifyTaskAssigned(created, user);

    return created;
  }

  private async getSubtaskCountsByParentIds(
    projectId: string,
    parentIds: string[],
  ): Promise<Map<string, { total: number; completed: number }>> {
    const map = new Map<string, { total: number; completed: number }>();
    if (parentIds.length === 0 || typeof this.repo.manager?.query !== 'function') {
      return map;
    }

    const rows = await this.repo.manager.query(
      `SELECT
         parent_task_id AS "parentTaskId",
         COUNT(*)::int AS "total",
         COUNT(*) FILTER (WHERE status = $2)::int AS "completed"
       FROM tasks
       WHERE project_id = $1
         AND parent_task_id = ANY($3::uuid[])
         AND archived_at IS NULL
       GROUP BY parent_task_id`,
      [projectId, TaskStatus.COMPLETED, parentIds],
    );

    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row?.parentTaskId) {
          map.set(row.parentTaskId, {
            total: Number(row.total) || 0,
            completed: Number(row.completed) || 0,
          });
        }
      }
    }

    return map;
  }

  async findAllByProject(filters: FilterTasksDto, user: RequestUser) {
    const project = await this.findProjectOrThrow(filters.projectId);

    const allowed = await this.permissions.canViewTask(user, project);
    if (!allowed) {
      throw new ForbiddenException('No tenés acceso a este proyecto.');
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;

    const buildBaseQb = () => {
      const qb = this.repo
        .createQueryBuilder('task')
        .where('task.projectId = :projectId', { projectId: filters.projectId });

      if (!filters.includeSubtasks) {
        qb.andWhere('task.parentTaskId IS NULL');
      }

      if (filters.status) {
        qb.andWhere('task.status = :status', { status: filters.status });
      }
      if (filters.priority) {
        qb.andWhere('task.priority = :priority', { priority: filters.priority });
      }
      if (filters.assignedToId) {
        qb.andWhere('task.assignedToId = :assignedToId', { assignedToId: filters.assignedToId });
      }
      if (filters.search) {
        qb.andWhere(
          '(task.title ILIKE :search OR task.description ILIKE :search)',
          { search: `%${filters.search}%` },
        );
      }
      return qb;
    };

    const dataQb = buildBaseQb()
      .leftJoinAndSelect('task.assignedTo', 'assignedTo')
      .leftJoinAndSelect('task.project', 'project');

    if (filters.myTasks) {
      dataQb.andWhere('task.assignedToId = :currentUserId', { currentUserId: user.id });
    }
    if (filters.atRisk) {
      dataQb.andWhere(
        '((task.dueDate < NOW() AND task.status != :completedStatus) OR task.status = :blockedStatus)',
        { completedStatus: TaskStatus.COMPLETED, blockedStatus: TaskStatus.BLOCKED },
      );
    }

    dataQb.orderBy('task.createdAt', 'DESC');

    const [data, total] = await dataQb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    if (data.length > 0) {
      const countsByParent = await this.getSubtaskCountsByParentIds(
        filters.projectId,
        data.map((t) => t.id),
      );

      for (const task of data) {
        const counts = countsByParent.get(task.id);
        task.subtaskCount = counts?.total ?? 0;
        task.completedSubtaskCount = counts?.completed ?? 0;
      }
    }

    const [allCount, mineCount, atRiskCount] = await Promise.all([
      buildBaseQb().getCount(),
      buildBaseQb()
        .andWhere('task.assignedToId = :currentUserId', { currentUserId: user.id })
        .getCount(),
      buildBaseQb()
        .andWhere(
          '((task.dueDate < NOW() AND task.status != :completedStatus) OR task.status = :blockedStatus)',
          { completedStatus: TaskStatus.COMPLETED, blockedStatus: TaskStatus.BLOCKED },
        )
        .getCount(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      counts: { all: allCount, mine: mineCount, atRisk: atRiskCount },
    };
  }

  async findOne(id: string, user: RequestUser, projectId?: string): Promise<TaskEntity> {
    const task = await this.findTaskOrThrow(id, projectId);

    const allowed = await this.permissions.canViewTask(user, task.project);
    if (!allowed) {
      throw new ForbiddenException('No tenés acceso a esta tarea.');
    }

    return task;
  }

  /** Subtareas de una tarea */
  async findSubtasks(parentTaskId: string, user: RequestUser): Promise<TaskEntity[]> {
    await this.findOne(parentTaskId, user);

    return this.repo.find({
      where: { parentTaskId },
      relations: ['assignedTo'],
      order: { createdAt: 'ASC' },
    });
  }

  async update(id: string, dto: UpdateTaskDto, user: RequestUser, source?: ChangeSource): Promise<TaskEntity> {
    const task = await this.findTaskOrThrow(id);

    const allowed = await this.permissions.canEditTask(user, task, task.project);
    if (!allowed) {
      throw new ForbiddenException('No podés editar esta tarea.');
    }

    // Planificación (fechas): permiso aparte de editar. Se resuelve ANTES de mutar nada, así
    // un request mixto (ej. description + dueDate) sin permiso de planificación se rechaza
    // entero y no se aplica ni la parte permitida.
    if (this.changesPlanning(task, dto) && !this.permissions.canManageTaskPlanning(user, task.project)) {
      throw new ForbiddenException('No podés modificar las fechas de esta tarea.');
    }

    this.assertDatesConsistent(task, dto);

    if (dto.assignedToId) {
      await this.assertAssigneeIsProjectMember(task.project, dto.assignedToId);
    }

    // Validar transición de estado si se está cambiando el status
    if (dto.status !== undefined && dto.status !== task.status) {
      this.validateTransition(task.status, dto.status);
    }

    // no se puede completar una tarea si tiene subtareas sin completar (salvo confirmación explícita completeSubtasks: true).
    if (dto.status === TaskStatus.COMPLETED && !dto.completeSubtasks) {
      const pendingSubtasks = await this.subtaskRepo.count({
        where: { taskId: task.id, completed: false },
      });
      const pendingChildTasks = await this.repo.count({
        where: { parentTaskId: task.id, status: Not(TaskStatus.COMPLETED), archivedAt: IsNull() },
      });
      if (pendingSubtasks > 0 || pendingChildTasks > 0) {
        throw new BadRequestException('No se puede completar una tarea con subtareas pendientes');
      }
    }

    // Se guarda antes de la transacción porque `task` se muta adentro.
    const previousAssigneeId = task.assignedToId;

    const updated = await this.repo.manager.transaction(async (manager) => {
      if (dto.status === TaskStatus.COMPLETED && dto.completeSubtasks) {
        await this.completePendingSubtasksAtomically(task, user, manager, source);
      }
      const changes: Record<string, { old: any; new: any }> = {};

      // Si cambió el título, actualizar el slug de la tarea y registrar el anterior en el histórico
      if (dto.title !== undefined && dto.title.trim() && dto.title.trim() !== task.title) {
        const oldSlug = task.slug;
        const candidateBaseSlug = slugify(dto.title.trim(), 'tarea');
        if (candidateBaseSlug && candidateBaseSlug !== task.slug) {
          const newSlug = await this.generateUniqueSlug(
            dto.title.trim(),
            task.projectId,
            manager,
            task.id,
          );
          if (newSlug !== task.slug) {
            // Si el newSlug estaba en el histórico de esta misma tarea, liberarlo
            await manager.delete(TaskSlugHistoryEntity, { taskId: task.id, slug: newSlug });

            if (oldSlug) {
              const historyRecord = this.taskSlugHistoryRepo.create({
                taskId: task.id,
                projectId: task.projectId,
                slug: oldSlug,
              });
              await manager.save(TaskSlugHistoryEntity, historyRecord);
            }
            changes.slug = { old: oldSlug, new: newSlug };
            task.slug = newSlug;
          }
        }
      }

      const trackChange = (field: keyof TaskEntity, dtoField: keyof UpdateTaskDto) => {
        if (dto[dtoField] !== undefined && task[field] !== dto[dtoField]) {
          changes[field as string] = { old: task[field], new: dto[dtoField] };
          (task as any)[field] = dto[dtoField];
        }
      };

      trackChange('title', 'title');
      trackChange('description', 'description');
      trackChange('priority', 'priority');
      trackChange('status', 'status');
      trackChange('assignedToId', 'assignedToId');
      trackChange('startDate', 'startDate');
      trackChange('dueDate', 'dueDate');

      const saved = await manager.save(TaskEntity, task);

      if (Object.keys(changes).length > 0) {
        await this.activityService.logEvent(
          {
            projectId: saved.projectId,
            actorId: user.id,
            actionType: ProjectActivityAction.TASK_UPDATED,
            entityType: ProjectActivityEntityType.TASK,
            entityId: saved.id,
            metadata: withSourceMetadata({ changes }, source),
            ...originOf(source),
          },
          manager,
        );
      }

      if (saved.milestoneId && changes.status !== undefined) {
        await syncMilestoneAutoCompletionWithManager(manager, saved.milestoneId);
      }

      return saved;
    });

    // Notificar solo si la tarea se reasignó a otra persona (fuera de la transacción).
    if (updated.assignedToId && updated.assignedToId !== previousAssigneeId) {
      await this.notifyTaskAssigned(updated, user);
    }

    return updated;
  }

  private async validateMentions(
    content: string,
    mentions: CommentMentionDto[] | undefined,
    task: TaskEntity,
  ): Promise<CommentMentionDto[]> {
    if (!mentions || mentions.length === 0) return [];

    const sorted = [...mentions].sort((a, b) => a.startIndex - b.startIndex);

    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i]!;
      if (m.startIndex < 0 || m.endIndex > content.length || m.startIndex >= m.endIndex) {
        throw new BadRequestException(`Rango de mención inválido [${m.startIndex}, ${m.endIndex}]`);
      }

      const prev = sorted[i - 1];
      if (prev && m.startIndex < prev.endIndex) {
        throw new BadRequestException('Las menciones no pueden superponerse');
      }

      const expectedText = content.substring(m.startIndex, m.endIndex);
      if (expectedText !== `@${m.name}`) {
        throw new BadRequestException(
          `El texto de la mención en posición [${m.startIndex}, ${m.endIndex}] ("${expectedText}") no coincide con "@${m.name}"`,
        );
      }

      const user = await this.usersService.findById(m.userId);
      if (!user || !user.active || (user as any).deletedAt) {
        throw new BadRequestException(`El usuario mencionado ${m.name} no existe o no está activo`);
      }

      const requestUser: RequestUser = {
        id: user.id,
        roles: Array.isArray((user as any).roles) ? (user as any).roles : [],
      } as RequestUser;

      const hasAccess = await this.permissions.canViewTask(requestUser, task.project);
      if (!hasAccess) {
        throw new BadRequestException(`El usuario mencionado ${m.name} no tiene acceso a esta tarea`);
      }
    }

    return sorted;
  }

  async addComment(
    taskId: string,
    content: string,
    user: RequestUser,
    mentions?: CommentMentionDto[],
  ): Promise<CommentEntity> {
    const task = await this.findTaskOrThrow(taskId);
    // Escribir un comentario NO es ver la tarea: policy propia (OBSERVER ve pero no comenta).
    const allowed = await this.permissions.canCommentOnTask(user, task.project);
    if (!allowed) throw new ForbiddenException('No podés comentar en esta tarea.');

    const trimmed = content?.trim();
    if (!trimmed) throw new BadRequestException('El comentario no puede estar vacío');

    const validatedMentions = await this.validateMentions(content, mentions, task);

    const comment = this.commentRepo.create({
      taskId,
      authorUserId: user.id,
      content: trimmed,
    });
    const saved = await this.commentRepo.save(comment);

    if (validatedMentions.length > 0) {
      const mentionEntities = validatedMentions.map((m) =>
        this.commentMentionRepo.create({
          commentId: saved.id,
          userId: m.userId,
          name: m.name,
          startIndex: m.startIndex,
          endIndex: m.endIndex,
        }),
      );
      saved.mentions = await this.commentMentionRepo.save(mentionEntities);
    } else {
      saved.mentions = [];
    }

    return saved;
  }

  async updateComment(
    taskId: string,
    commentId: string,
    content: string,
    user: RequestUser,
    mentions?: CommentMentionDto[],
  ): Promise<CommentEntity> {
    const task = await this.findTaskOrThrow(taskId);
    const allowed = await this.permissions.canViewTask(user, task.project);
    if (!allowed) throw new ForbiddenException('No podés acceder a esta tarea.');

    const comment = await this.commentRepo.findOne({ where: { id: commentId } });
    if (!comment || comment.deletedAt) {
      throw new NotFoundException('Comentario no encontrado');
    }

    if (comment.taskId !== task.id) {
      throw new NotFoundException('El comentario no pertenece a esta tarea');
    }

    if (comment.authorUserId !== user.id) {
      throw new ForbiddenException('Solo el autor puede editar este comentario');
    }

    const trimmed = content?.trim();
    if (!trimmed) {
      throw new BadRequestException('El comentario no puede estar vacío');
    }

    const validatedMentions = await this.validateMentions(content, mentions, task);

    comment.content = trimmed;
    comment.editedAt = new Date();
    const saved = await this.commentRepo.save(comment);

    await this.commentMentionRepo.delete({ commentId: comment.id });

    if (validatedMentions.length > 0) {
      const mentionEntities = validatedMentions.map((m) =>
        this.commentMentionRepo.create({
          commentId: saved.id,
          userId: m.userId,
          name: m.name,
          startIndex: m.startIndex,
          endIndex: m.endIndex,
        }),
      );
      saved.mentions = await this.commentMentionRepo.save(mentionEntities);
    } else {
      saved.mentions = [];
    }

    return saved;
  }

  async deleteComment(
    taskId: string,
    commentId: string,
    user: RequestUser,
  ): Promise<{ success: boolean }> {
    const task = await this.findTaskOrThrow(taskId);
    const allowed = await this.permissions.canViewTask(user, task.project);
    if (!allowed) throw new ForbiddenException('No podés acceder a esta tarea.');

    const comment = await this.commentRepo.findOne({ where: { id: commentId } });
    if (!comment || comment.deletedAt) {
      throw new NotFoundException('Comentario no encontrado');
    }

    if (comment.taskId !== task.id) {
      throw new NotFoundException('El comentario no pertenece a esta tarea');
    }

    if (comment.authorUserId !== user.id) {
      throw new ForbiddenException('Solo el autor puede eliminar este comentario');
    }

    comment.deletedAt = new Date();
    await this.commentRepo.save(comment);
    return { success: true };
  }

  async getTimeline(taskId: string, user: RequestUser, page = 1, limit = 10) {
    const task = await this.findTaskOrThrow(taskId);
    const allowed = await this.permissions.canViewTask(user, task.project);
    if (!allowed) throw new ForbiddenException('No podés acceder a esta tarea.');

    const comments = await this.commentRepo.find({
      where: { taskId },
      relations: ['author', 'mentions'],
    });

    const activeComments = comments.filter((c: CommentEntity) => !c.deletedAt);

    const mappedComments = activeComments.map((c: CommentEntity) => ({
      id: c.id,
      type: 'COMMENT',
      content: c.content,
      actor: { id: c.author.id, name: c.author.name, avatar: c.author.name.substring(0, 2).toUpperCase() },
      createdAt: c.createdAt,
      editedAt: c.editedAt ?? null,
      mentions: (c.mentions || []).map((m) => ({
        userId: m.userId,
        name: m.name,
        startIndex: m.startIndex,
        endIndex: m.endIndex,
      })),
    }));

    const activities = await this.projectRepo.manager.find(ProjectActivityEntity, {
      where: { entityType: ProjectActivityEntityType.TASK, entityId: taskId },
      relations: ['actor'],
    });

    const mappedActivities = activities.map((a: ProjectActivityEntity) => ({
      id: a.id,
      type: 'HISTORY',
      actionType: a.actionType,
      metadata: a.metadata,
      actor: { id: a.actor.id, name: a.actor.name, avatar: a.actor.name.substring(0, 2).toUpperCase() },
      createdAt: a.createdAt,
    }));

    const timeline = [...mappedComments, ...mappedActivities];
    timeline.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    const total = timeline.length;
    const start = (page - 1) * limit;
    const data = timeline.slice(start, start + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async archive(id: string, user: RequestUser): Promise<TaskEntity> {
    const task = await this.findTaskOrThrow(id);

    const allowed = this.permissions.canDeleteTask(user, task.project);
    if (!allowed) {
      throw new ForbiddenException('No podés eliminar esta tarea.');
    }

    if (task.archivedAt) {
      return task;
    }

    return this.repo.manager.transaction(async (manager) => {
      task.archivedAt = new Date();
      const saved = await manager.save(TaskEntity, task);

      await this.activityService.logEvent(
        {
          projectId: saved.projectId,
          actorId: user.id,
          actionType: ProjectActivityAction.TASK_DELETED,
          entityType: ProjectActivityEntityType.TASK,
          entityId: saved.id,
          metadata: { archivedAt: saved.archivedAt },
        },
        manager,
      );

      if (saved.milestoneId) {
        await syncMilestoneAutoCompletionWithManager(manager, saved.milestoneId);
      }

      return saved;
    });
  }

  /**
   * Valida permisos y transiciones en todas las subtareas pendientes de una tarea principal y
   * las completa atómicamente antes de completar la tarea principal.
   */
  private async completePendingSubtasksAtomically(
    task: TaskEntity,
    user: RequestUser,
    manager: EntityManager,
    source?: ChangeSource,
  ): Promise<void> {
    let pendingChildTasks: TaskEntity[] = [];
    if (typeof manager?.find === 'function') {
      pendingChildTasks =
        (await manager.find(TaskEntity, {
          where: { parentTaskId: task.id, status: Not(TaskStatus.COMPLETED), archivedAt: IsNull() } as any,
          order: { createdAt: 'ASC' } as any,
        })) ?? [];
    } else if (typeof this.repo.find === 'function') {
      pendingChildTasks =
        (await this.repo.find({
          where: { parentTaskId: task.id, status: Not(TaskStatus.COMPLETED), archivedAt: IsNull() },
          order: { createdAt: 'ASC' },
        })) ?? [];
    }

    // 1. Validar permisos y reglas de transición en cada subtarea antes de mutar registros
    for (const child of pendingChildTasks) {
      const canEditSub = await this.permissions.canEditTask(user, child, task.project);
      if (!canEditSub) {
        throw new ForbiddenException(`No podés cambiar el estado de la subtarea "${child.title}".`);
      }
      this.validateTransition(child.status, TaskStatus.COMPLETED);
    }

    // 2. Completar primero las subtareas pendientes
    for (const child of pendingChildTasks) {
      const oldSubStatus = child.status;
      child.status = TaskStatus.COMPLETED;
      const savedChild = await manager.save(TaskEntity, child);
      await this.activityService.logEvent(
        {
          projectId: savedChild.projectId,
          actorId: user.id,
          actionType: ProjectActivityAction.TASK_UPDATED,
          entityType: ProjectActivityEntityType.TASK,
          entityId: savedChild.id,
          metadata: withSourceMetadata(
            { changes: { status: { old: oldSubStatus, new: TaskStatus.COMPLETED } } },
            source,
          ),
          ...originOf(source),
        },
        manager,
      );
    }

    // Las subtareas completadas en cascada pueden pertenecer a otros hitos.
    for (const milestoneId of new Set(pendingChildTasks.map((child) => child.milestoneId).filter(Boolean))) {
      await syncMilestoneAutoCompletionWithManager(manager, milestoneId);
    }

    // 3. Si existieran subtareas de la tabla legacy subtasks pendientes, completarlas también
    const pendingLegacyCount = await this.subtaskRepo.count({
      where: { taskId: task.id, completed: false },
    });
    if (pendingLegacyCount > 0 && typeof manager?.update === 'function') {
      await manager.update(SubtaskEntity, { taskId: task.id, completed: false }, { completed: true });
    }
  }

  /**
   * Cambia el estado de una tarea validando la transición.
   * Endpoint dedicado: PATCH /tasks/:id/status
   */
  async updateStatus(id: string, dto: UpdateTaskStatusDto, user: RequestUser, source?: ChangeSource): Promise<TaskEntity> {
    const task = await this.findTaskOrThrow(id);

    const allowed = await this.permissions.canEditTask(user, task, task.project);
    if (!allowed) {
      throw new ForbiddenException('No podés cambiar el estado de esta tarea.');
    }

    if (task.status === dto.status) {
      return task;
    }

    this.validateTransition(task.status, dto.status);

    if (dto.status === TaskStatus.COMPLETED && !dto.completeSubtasks) {
      const pendingSubtasks = await this.subtaskRepo.count({
        where: { taskId: task.id, completed: false },
      });
      const pendingChildTasks = await this.repo.count({
        where: { parentTaskId: task.id, status: Not(TaskStatus.COMPLETED), archivedAt: IsNull() },
      });
      if (pendingSubtasks > 0 || pendingChildTasks > 0) {
        throw new BadRequestException('No se puede completar una tarea con subtareas pendientes');
      }
    }

    return this.repo.manager.transaction(async (manager) => {
      if (dto.status === TaskStatus.COMPLETED && dto.completeSubtasks) {
        await this.completePendingSubtasksAtomically(task, user, manager, source);
      }

      const oldStatus = task.status;
      task.status = dto.status;
      const saved = await manager.save(TaskEntity, task);

      await this.activityService.logEvent(
        {
          projectId: saved.projectId,
          actorId: user.id,
          actionType: ProjectActivityAction.TASK_UPDATED,
          entityType: ProjectActivityEntityType.TASK,
          entityId: saved.id,
          metadata: withSourceMetadata({ changes: { status: { old: oldStatus, new: dto.status } } }, source),
          ...originOf(source),
        },
        manager,
      );

      if (saved.milestoneId) {
        await syncMilestoneAutoCompletionWithManager(manager, saved.milestoneId);
      }

      return saved;
    });
  }

  /**
   * ¿El DTO modifica realmente algún campo de planificación? Solo cuenta si el valor enviado
   * difiere del actual: reenviar la misma fecha (el form de edición manda todos los campos)
   * no cambia nada, así que no exige el permiso de planificación.
   */
  private changesPlanning(task: TaskEntity, dto: UpdateTaskDto): boolean {
    const changed = (incoming: string | null | undefined, current: string | null) =>
      incoming !== undefined && incoming !== current;
    return changed(dto.startDate, task.startDate) || changed(dto.dueDate, task.dueDate);
  }

  /** Con updates parciales, el orden se evalúa sobre el resultado final: valor nuevo o, si no viene, el actual. */
  private assertDatesConsistent(task: TaskEntity, dto: UpdateTaskDto): void {
    if (dto.startDate === undefined && dto.dueDate === undefined) return;

    const startDate = dto.startDate !== undefined ? dto.startDate : task.startDate;
    const dueDate = dto.dueDate !== undefined ? dto.dueDate : task.dueDate;
    if (startDate && dueDate && dueDate < startDate) {
      throw new BadRequestException(
        `La fecha de vencimiento (${dueDate}) no puede ser anterior a la de inicio (${startDate}).`,
      );
    }
  }

  private validateTransition(from: TaskStatus, to: TaskStatus): void {
    if (!isValidTransition(from, to)) {
      const fromLabel = TASK_STATUS_LABELS[from];
      const toLabel = TASK_STATUS_LABELS[to];
      const allowed = VALID_TRANSITIONS[from];

      if (allowed.length === 0) {
        throw new BadRequestException(
          `La tarea está en estado "${fromLabel}" y no permite transiciones. Es un estado final.`,
        );
      }

      const allowedLabels = allowed.map((s) => TASK_STATUS_LABELS[s]).join(', ');

      throw new BadRequestException(
        `No se puede pasar de "${fromLabel}" a "${toLabel}". ` +
          `Transiciones permitidas desde "${fromLabel}": ${allowedLabels}.`,
      );
    }
  }
}