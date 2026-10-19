import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { TaskEntity } from './task.entity';
import { SubtaskEntity } from '../subtasks/subtask.entity';
import { ProjectEntity } from '../projects/project.entity';
import { CommentEntity } from '../database/entities/comment.entity';
import { ProjectActivityService } from '../projects/project-activity.service';
import { ProjectActivityAction, ProjectActivityEntityType } from '../database/enums';
import { ProjectActivityEntity } from '../database/entities/project-activity.entity';
import { TaskPriority, TaskStatus } from '../database/enums';
import { UsersService } from '../users/users.service';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { FilterTasksDto } from './dto/filter-tasks.dto';
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
@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly repo: Repository<TaskEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(CommentEntity)
    private readonly commentRepo: Repository<CommentEntity>,
    private readonly usersService: UsersService,
    private readonly permissions: PermissionsService,
    private readonly activityService: ProjectActivityService,
    @InjectRepository(SubtaskEntity)
    private readonly subtaskRepo: Repository<SubtaskEntity>,
  ) {}

  private async findProjectOrThrow(projectId: string): Promise<ProjectEntity> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    return project;
  }

  /** Sin chequeo de autorización */
  private async findTaskOrThrow(id: string): Promise<TaskEntity> {
    const task = await this.repo.findOne({
      where: { id },
      relations: ['project', 'assignedTo'],
    });
    if (!task) {
      throw new NotFoundException(`Task ${id} no encontrada`);
    }
    return task;
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

  async create(dto: CreateTaskDto, user: RequestUser): Promise<TaskEntity> {
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

    const task = new TaskEntity();
    task.projectId = dto.projectId;
    task.parentTaskId = dto.parentTaskId ?? null;
    task.title = dto.title;
    task.description = dto.description ?? null;
    task.status = dto.status ?? TaskStatus.PENDING;
    task.priority = dto.priority ?? TaskPriority.MEDIUM;
    task.assignedToId = dto.assignedToId ?? null;
    task.startDate = dto.startDate ?? null;
    task.dueDate = dto.dueDate ?? null;
    task.createdBy = user.id;

    const saved = await this.repo.save(task);
    await this.activityService.logEvent({
      projectId: saved.projectId,
      actorId: user.id,
      actionType: ProjectActivityAction.TASK_CREATED,
      entityType: ProjectActivityEntityType.TASK,
      entityId: saved.id,
      metadata: { title: saved.title },
    });
    return saved;
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

  async findOne(id: string, user: RequestUser): Promise<TaskEntity> {
    const task = await this.findTaskOrThrow(id);

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

  async update(id: string, dto: UpdateTaskDto, user: RequestUser): Promise<TaskEntity> {
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

    // no se puede completar una tarea si tiene subtareas sin completar.
    if (dto.status === TaskStatus.COMPLETED) {
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

    
    const changes: Record<string, { old: any; new: any }> = {};
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

    const saved = await this.repo.save(task);

    if (Object.keys(changes).length > 0) {
      await this.activityService.logEvent({
        projectId: saved.projectId,
        actorId: user.id,
        actionType: ProjectActivityAction.TASK_UPDATED,
        entityType: ProjectActivityEntityType.TASK,
        entityId: saved.id,
        metadata: { changes },
      });
    }

    return saved;

  }


  
  async addComment(taskId: string, content: string, user: RequestUser): Promise<CommentEntity> {
    const task = await this.findTaskOrThrow(taskId);
    // Escribir un comentario NO es ver la tarea: policy propia (OBSERVER ve pero no comenta).
    const allowed = await this.permissions.canCommentOnTask(user, task.project);
    if (!allowed) throw new ForbiddenException('No podés comentar en esta tarea.');

    const trimmed = content?.trim();
    if (!trimmed) throw new BadRequestException('El comentario no puede estar vacío');

    const comment = this.commentRepo.create({
      taskId,
      authorUserId: user.id,
      content: trimmed,
    });
    return this.commentRepo.save(comment);
  }

  async getTimeline(taskId: string, user: RequestUser, page = 1, limit = 10) {
    const task = await this.findTaskOrThrow(taskId);
    const allowed = await this.permissions.canViewTask(user, task.project);
    if (!allowed) throw new ForbiddenException('No podés acceder a esta tarea.');

    const comments = await this.commentRepo.find({
      where: { taskId },
      relations: ['author'],
    });

    const mappedComments = comments.map((c: CommentEntity) => ({
      id: c.id,
      type: 'COMMENT',
      content: c.content,
      actor: { id: c.author.id, name: c.author.name, avatar: c.author.name.substring(0, 2).toUpperCase() },
      createdAt: c.createdAt,
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

    task.archivedAt = new Date();
    const saved = await this.repo.save(task);

    await this.activityService.logEvent({
      projectId: saved.projectId,
      actorId: user.id,
      actionType: ProjectActivityAction.TASK_DELETED,
      entityType: ProjectActivityEntityType.TASK,
      entityId: saved.id,
      metadata: { archivedAt: saved.archivedAt },
    });

    return saved;
  }

  /**
   * Cambia el estado de una tarea validando la transición.
   * Endpoint dedicado: PATCH /tasks/:id/status
   */
  async updateStatus(id: string, dto: UpdateTaskStatusDto, user: RequestUser): Promise<TaskEntity> {
    const task = await this.findTaskOrThrow(id);

    const allowed = await this.permissions.canEditTask(user, task, task.project);
    if (!allowed) {
      throw new ForbiddenException('No podés cambiar el estado de esta tarea.');
    }

    if (task.status === dto.status) {
      return task;
    }

    this.validateTransition(task.status, dto.status);

    if (dto.status === TaskStatus.COMPLETED) {
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

    const oldStatus = task.status;
    task.status = dto.status;
    const saved = await this.repo.save(task);

    await this.activityService.logEvent({
      projectId: saved.projectId,
      actorId: user.id,
      actionType: ProjectActivityAction.TASK_UPDATED,
      entityType: ProjectActivityEntityType.TASK,
      entityId: saved.id,
      metadata: { changes: { status: { old: oldStatus, new: dto.status } } },
    });

    return saved;
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
