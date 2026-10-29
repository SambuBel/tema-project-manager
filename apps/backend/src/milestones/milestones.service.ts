import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { MilestoneEntity } from './milestone.entity';
import { ProjectEntity } from '../projects/project.entity';
import { TaskEntity } from '../tasks/task.entity';
import { isValidTransition, TASK_STATUS_LABELS } from '../tasks/task-transitions';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { ListMilestonesQueryDto } from './dto/list-milestones-query.dto';
import {
  MilestoneDetailDto,
  MilestoneSummaryDto,
  MilestoneTaskDto,
  MilestoneUserDto,
} from './dto/milestone-response.dto';
import { TaskStatus } from '../database/enums';
import type { MilestoneStatus } from '@tema/shared-types';
import {
  MILESTONE_PROGRESS_TASK_PREDICATE,
  milestoneProgressTasks,
  syncMilestoneAutoCompletionWithManager,
} from './milestone-auto-completion.helper';

@Injectable()
export class MilestonesService {
  constructor(
    @InjectRepository(MilestoneEntity)
    private readonly milestoneRepo: Repository<MilestoneEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Crea un nuevo Milestone en el proyecto indicado (KAN-243).
   * - Asigna createdBy a partir del usuario autenticado.
   * - Valida existencia del proyecto y permisos de administración.
   * - Evita nombres duplicados (case-insensitive) y captura carreras de concurrencia.
   */
  async create(
    projectId: string,
    dto: CreateMilestoneDto,
    user: RequestUser,
  ): Promise<MilestoneSummaryDto> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Proyecto con id ${projectId} no encontrado`);
    }

    if (!this.permissions.canManageMilestones(user, project)) {
      throw new ForbiddenException('No tenés permisos para crear hitos en este proyecto');
    }

    const trimmedName = dto.name.trim().replace(/\s+/g, ' ');

    // Verificación preventiva de unicidad case-insensitive en memoria
    const existing = await this.milestoneRepo
      .createQueryBuilder('m')
      .where('m.projectId = :projectId', { projectId })
      .andWhere('LOWER(m.name) = LOWER(:name)', { name: trimmedName })
      .andWhere('m.deletedAt IS NULL')
      .getOne();

    if (existing) {
      throw new ConflictException(`Ya existe un hito con el nombre "${trimmedName}" en este proyecto`);
    }

    const milestone = this.milestoneRepo.create({
      projectId,
      name: trimmedName,
      description: dto.description?.trim() || null,
      dueDate: dto.dueDate,
      createdBy: user.id,
    });

    try {
      const saved = await this.milestoneRepo.save(milestone);
      // Recargar con relaciones de auditoría mínimas
      const reloaded = await this.milestoneRepo.findOne({
        where: { id: saved.id },
        relations: ['creator'],
      });
      return this.toSummaryDto(reloaded || saved, 0, 0);
    } catch (error: any) {
      if (error?.code === '23505' || error?.constraint === 'uq_milestones_project_name_active') {
        throw new ConflictException(`Ya existe un hito con el nombre "${trimmedName}" en este proyecto`);
      }
      throw error;
    }
  }

  /**
   * Lista los Milestones activos de un proyecto con avance calculado y sin N+1 (KAN-243).
   * - Comprueba permisos de lectura del proyecto.
   * - Permite filtrar próximos hitos (`upcoming: true`) y limitar cantidad (`limit`).
   * - Ordena de forma estable por dueDate ASC, createdAt ASC.
   */
  async findAllByProject(
    projectId: string,
    query: ListMilestonesQueryDto,
    user: RequestUser,
  ): Promise<MilestoneSummaryDto[]> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Proyecto con id ${projectId} no encontrado`);
    }

    const canView = await this.permissions.canViewProject(user, project);
    if (!canView) {
      throw new ForbiddenException('No tenés acceso a este proyecto');
    }

    const qb = this.milestoneRepo
      .createQueryBuilder('milestone')
      .leftJoinAndSelect('milestone.creator', 'creator')
      .leftJoinAndSelect('milestone.completedBy', 'completedBy')
      .where('milestone.projectId = :projectId', { projectId })
      .andWhere('milestone.deletedAt IS NULL')
      .orderBy('milestone.dueDate', 'ASC')
      .addOrderBy('milestone.createdAt', 'ASC');

    if (query?.upcoming) {
      const today = new Date().toISOString().slice(0, 10);
      qb.andWhere('milestone.completedAt IS NULL');
      qb.andWhere('milestone.dueDate >= :today', { today });
    }

    if (query?.limit && query.limit > 0) {
      qb.take(query.limit);
    }

    const milestones = await qb.getMany();
    if (milestones.length === 0) {
      return [];
    }

    // Consulta agregada única para calcular contadores de elementos vinculados sin duplicar subtareas representadas por su tarea principal sin N+1
    const statsMap = await this.getTaskStatsForMilestones(milestones.map((m) => m.id));

    return milestones.map((m) => {
      const stats = statsMap.get(m.id) ?? { taskCount: 0, completedTaskCount: 0 };
      return this.toSummaryDto(m, stats.taskCount, stats.completedTaskCount);
    });
  }

  /**
   * Consulta el detalle de un Milestone con sus tareas y subtareas vinculadas activas (KAN-243 / KAN-248).
   */
  async findOne(id: string, user: RequestUser): Promise<MilestoneDetailDto> {
    const milestone = await this.milestoneRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['project', 'creator', 'completedBy'],
    });

    if (!milestone) {
      throw new NotFoundException(`Milestone con id ${id} no encontrado`);
    }

    const canView = await this.permissions.canViewProject(user, milestone.project);
    if (!canView) {
      throw new ForbiddenException('No tenés acceso a este proyecto');
    }

    // Traer tareas y subtareas vinculadas activas
    const tasks = await this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignedTo', 'assignedTo')
      .leftJoinAndSelect('task.parentTask', 'parentTask')
      .where('task.milestoneId = :id', { id })
      .andWhere('task.archivedAt IS NULL')
      .orderBy('task.dueDate', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'ASC')
      .getMany();

    const rootTasks = milestoneProgressTasks(tasks);
    const taskCount = rootTasks.length;
    const completedTaskCount = rootTasks.filter((t) => t.status === TaskStatus.COMPLETED).length;

    const rootTaskIds = tasks.filter((t) => !t.parentTaskId).map((t) => t.id);
    const subtaskStatsMap = await this.getSubtaskStatsForParentTasks(rootTaskIds);

    return this.toDetailDto(milestone, tasks, taskCount, completedTaskCount, subtaskStatsMap);
  }

  /**
   * Actualiza parcialmente un Milestone existente (KAN-244).
   * - Permite modificar nombre, descripción y fecha objetivo.
   * - Valida unicidad case-insensitive del nuevo nombre dentro del proyecto.
   * - Valida permisos mediante canManageMilestones.
   * - No permite modificar projectId, createdBy ni fechas internas desde el body.
   */
  async update(
    id: string,
    dto: UpdateMilestoneDto,
    user: RequestUser,
  ): Promise<MilestoneSummaryDto> {
    const milestone = await this.milestoneRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['project', 'creator', 'completedBy'],
    });

    if (!milestone) {
      throw new NotFoundException(`Milestone con id ${id} no encontrado`);
    }

    if (!this.permissions.canManageMilestones(user, milestone.project)) {
      throw new ForbiddenException('No tenés permisos para editar este hito');
    }

    if (dto.name !== undefined) {
      const trimmedName = dto.name.trim().replace(/\s+/g, ' ');
      if (trimmedName.toLowerCase() !== milestone.name.toLowerCase()) {
        const existing = await this.milestoneRepo
          .createQueryBuilder('m')
          .where('m.projectId = :projectId', { projectId: milestone.projectId })
          .andWhere('LOWER(m.name) = LOWER(:name)', { name: trimmedName })
          .andWhere('m.id != :id', { id: milestone.id })
          .andWhere('m.deletedAt IS NULL')
          .getOne();

        if (existing) {
          throw new ConflictException(`Ya existe un hito con el nombre "${trimmedName}" en este proyecto`);
        }
      }
      milestone.name = trimmedName;
    }

    if (dto.dueDate !== undefined) {
      milestone.dueDate = dto.dueDate;
    }

    if (dto.description !== undefined) {
      milestone.description = dto.description ? dto.description.trim() : null;
    }

    try {
      await this.milestoneRepo.save(milestone);
    } catch (error: any) {
      if (error?.code === '23505' || error?.constraint === 'uq_milestones_project_name_active') {
        throw new ConflictException(`Ya existe un hito con el nombre "${dto.name}" en este proyecto`);
      }
      throw error;
    }

    const stats = await this.getTaskStatsForMilestones([milestone.id]);
    const stat = stats.get(milestone.id) ?? { taskCount: 0, completedTaskCount: 0 };
    return this.toSummaryDto(milestone, stat.taskCount, stat.completedTaskCount);
  }

  /**
   * Elimina lógicamente un Milestone desasociando sus tareas vinculadas en una transacción (KAN-244).
   * - Desasocia tareas vinculadas (tasks.milestone_id = null) sin eliminarlas.
   * - Marca milestone.deleted_at = now() (baja lógica).
   * - Todo se ejecuta de forma atómica dentro de una transacción con rollback automático si algo falla.
   */
  async remove(id: string, user: RequestUser): Promise<void> {
    const milestone = await this.milestoneRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['project'],
    });

    if (!milestone) {
      throw new NotFoundException(`Milestone con id ${id} no encontrado`);
    }

    if (!this.permissions.canManageMilestones(user, milestone.project)) {
      throw new ForbiddenException('No tenés permisos para eliminar este hito');
    }

    await this.milestoneRepo.manager.transaction(async (manager) => {
      // 1. Desasociar todas las tareas vinculadas al hito
      await manager
        .createQueryBuilder()
        .update(TaskEntity)
        .set({ milestoneId: null })
        .where('milestoneId = :id', { id })
        .execute();

      // 2. Baja lógica del hito
      await manager.softDelete(MilestoneEntity, id);
    });
  }

  /**
   * Marca manualmente un Milestone como completado sin modificar sus tareas asociadas (KAN-244 / KAN-250).
   * - Registra completedAt y completedById (usuario autenticado).
   * - Idempotente ante llamadas sucesivas.
   */
  async complete(id: string, user: RequestUser): Promise<MilestoneSummaryDto> {
    const milestone = await this.milestoneRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['project', 'creator', 'completedBy'],
    });

    if (!milestone) {
      throw new NotFoundException(`Milestone con id ${id} no encontrado`);
    }

    if (!this.permissions.canManageMilestones(user, milestone.project)) {
      throw new ForbiddenException('No tenés permisos para confirmar la finalización de este hito');
    }

    if (!milestone.completedAt || !milestone.completedById) {
      milestone.completedAt = milestone.completedAt ?? new Date();
      milestone.completedById = user.id;
      await this.milestoneRepo.save(milestone);
      milestone.completedBy = { id: user.id, name: user.name, email: user.email } as any;
    }

    const stats = await this.getTaskStatsForMilestones([milestone.id]);
    const stat = stats.get(milestone.id) ?? { taskCount: 0, completedTaskCount: 0 };
    return this.toSummaryDto(milestone, stat.taskCount, stat.completedTaskCount);
  }

  /**
   * Finalización conjunta de un Milestone junto con sus tareas asociadas pendientes y sus subtareas (KAN-250).
   * - Ejecuta toda la operación dentro de una única transacción atómica.
   * - Valida existencia del hito, permisos (`canManageMilestones` y `canEditTask`) y transiciones de estado
   *   tanto en las tareas principales pendientes como en sus subtareas pendientes.
   * - Completa primero todas las subtareas pendientes de las tareas asociadas y luego las tareas principales.
   * - Registra `completedAt` y `completedById` en el Milestone (confirmación manual/conjunta por el usuario).
   */
  async completeWithTasks(id: string, user: RequestUser): Promise<MilestoneSummaryDto> {
    return this.milestoneRepo.manager.transaction(async (manager) => {
      // 1. Validar existencia del Milestone activo
      const milestone = await manager.findOne(MilestoneEntity, {
        where: { id, deletedAt: IsNull() },
        relations: ['project', 'creator', 'completedBy'],
      });

      if (!milestone) {
        throw new NotFoundException(`Milestone con id ${id} no encontrado`);
      }

      // 2. Validar permisos sobre el Milestone
      if (!this.permissions.canManageMilestones(user, milestone.project)) {
        throw new ForbiddenException('No tenés permisos para confirmar la finalización conjunta de este hito');
      }

      // 3. Obtener tareas y subtareas activas vinculadas al hito
      const repo = manager.getRepository ? manager.getRepository(TaskEntity) : this.taskRepo;
      const tasks = await repo
        .createQueryBuilder('task')
        .where('task.milestoneId = :id', { id })
        .andWhere('task.archivedAt IS NULL')
        .orderBy('task.createdAt', 'ASC')
        .getMany();

      const rootTasks = tasks.filter((t) => !t.parentTaskId);
      const pendingRootTasks = rootTasks.filter((t) => t.status !== TaskStatus.COMPLETED);

      // 4. Obtener subtareas pendientes de las tareas principales asociadas al hito
      let pendingSubtasks: TaskEntity[] = [];
      if (pendingRootTasks.length > 0) {
        const rootPendingIds = pendingRootTasks.map((t) => t.id);
        const childQb = repo.createQueryBuilder('subtask');
        if (typeof childQb.where === 'function' && typeof childQb.getMany === 'function') {
          pendingSubtasks =
            (await childQb
              .where('subtask.parentTaskId IN (:...rootPendingIds)', { rootPendingIds })
              .andWhere('subtask.archivedAt IS NULL')
              .andWhere('subtask.status != :completedStatus', { completedStatus: TaskStatus.COMPLETED })
              .orderBy('subtask.createdAt', 'ASC')
              .getMany()) ?? [];
        }
      }

      // Incluir subtareas vinculadas individualmente y evitar actualizarlas dos veces.
      pendingSubtasks = [...new Map([
        ...pendingSubtasks,
        ...tasks.filter((task) => task.parentTaskId && task.status !== TaskStatus.COMPLETED),
      ].map((task) => [task.id, task])).values()];

      // 5. Validar permisos de edición y transición de estado en cada subtarea pendiente y cada tarea principal pendiente
      for (const subtask of pendingSubtasks) {
        if (typeof (this.permissions as any).canEditTask === 'function') {
          const canEditSub = await this.permissions.canEditTask(user, subtask, milestone.project);
          if (!canEditSub) {
            throw new ForbiddenException(`No tenés permisos para completar la subtarea "${subtask.title}"`);
          }
        }
        if (!isValidTransition(subtask.status, TaskStatus.COMPLETED)) {
          const fromLabel = TASK_STATUS_LABELS[subtask.status] ?? subtask.status;
          throw new BadRequestException(
            `La subtarea "${subtask.title}" está en estado "${fromLabel}" y no puede transicionar a Completada`,
          );
        }
      }

      for (const task of pendingRootTasks) {
        if (typeof (this.permissions as any).canEditTask === 'function') {
          const canEdit = await this.permissions.canEditTask(user, task, milestone.project);
          if (!canEdit) {
            throw new ForbiddenException(`No tenés permisos para completar la tarea "${task.title}"`);
          }
        }

        if (!isValidTransition(task.status, TaskStatus.COMPLETED)) {
          const fromLabel = TASK_STATUS_LABELS[task.status] ?? task.status;
          throw new BadRequestException(
            `La tarea "${task.title}" está en estado "${fromLabel}" y no puede transicionar a Completada`,
          );
        }
      }

      // 6. Completar primero las subtareas pendientes y luego las tareas principales pendientes
      for (const subtask of pendingSubtasks) {
        await manager.update(TaskEntity, subtask.id, { status: TaskStatus.COMPLETED });
      }
      for (const rootTask of pendingRootTasks) {
        await manager.update(TaskEntity, rootTask.id, { status: TaskStatus.COMPLETED });
      }

      // Sincronizar otros hitos de subtareas completadas por la finalización conjunta.
      for (const linkedMilestoneId of new Set(pendingSubtasks.map((task) => task.milestoneId).filter(Boolean))) {
        if (linkedMilestoneId !== id) {
          await syncMilestoneAutoCompletionWithManager(manager, linkedMilestoneId);
        }
      }

      // 7. Marcar el Milestone como alcanzado con confirmación del usuario actual
      if (!milestone.completedAt || !milestone.completedById) {
        milestone.completedAt = milestone.completedAt ?? new Date();
        milestone.completedById = user.id;
        milestone.completedBy = { id: user.id, name: user.name, email: user.email } as any;
        if (typeof (manager as any).save === 'function') {
          await (manager as any).save(MilestoneEntity, milestone);
        } else {
          await this.milestoneRepo.save(milestone);
        }
      }

      const stats = await this.getTaskStatsForMilestones([milestone.id], manager);
      const stat = stats.get(milestone.id) ?? {
        taskCount: rootTasks.length,
        completedTaskCount: rootTasks.length,
      };
      return this.toSummaryDto(milestone, stat.taskCount, stat.completedTaskCount);
    });
  }

  /**
   * Reabre un Milestone previamente completado (KAN-244 - Fase 4).
   * - Limpia completedAt y completedById.
   * - Idempotente ante llamadas sucesivas.
   */
  async reopen(id: string, user: RequestUser): Promise<MilestoneSummaryDto> {
    const milestone = await this.milestoneRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['project', 'creator', 'completedBy'],
    });

    if (!milestone) {
      throw new NotFoundException(`Milestone con id ${id} no encontrado`);
    }

    if (!this.permissions.canManageMilestones(user, milestone.project)) {
      throw new ForbiddenException('No tenés permisos para reabrir este hito');
    }

    if (milestone.completedAt) {
      milestone.completedAt = null;
      milestone.completedById = null;
      milestone.completedBy = null;
      await this.milestoneRepo.save(milestone);
    }

    const stats = await this.getTaskStatsForMilestones([milestone.id]);
    const stat = stats.get(milestone.id) ?? { taskCount: 0, completedTaskCount: 0 };
    return this.toSummaryDto(milestone, stat.taskCount, stat.completedTaskCount);
  }

  /**
   * Asocia una tarea o subtarea a un Milestone de forma transaccional e idempotente (KAN-245 / KAN-247).
   * - Valida existencia del hito (activo) y permisos de administración.
   * - Valida existencia de la tarea o subtarea,
   *   que no esté archivada y que pertenezca al mismo proyecto.
   * - Si ya está asociada al mismo hito, es idempotente (retorna resumen sin cambios).
   * - Si está asociada a otro hito activo, responde 409 Conflict sin reasignar silenciosamente.
   * - Sincroniza el estado de finalización automática del hito tras asociar la tarea.
   */
  async associateTask(
    milestoneId: string,
    taskId: string,
    user: RequestUser,
  ): Promise<MilestoneSummaryDto> {
    return this.milestoneRepo.manager.transaction(async (manager) => {
      // 1. Validar existencia y estado activo del Milestone
      const milestone = await manager.findOne(MilestoneEntity, {
        where: { id: milestoneId, deletedAt: IsNull() },
        relations: ['project', 'creator', 'completedBy'],
      });

      if (!milestone) {
        throw new NotFoundException(`Milestone con id ${milestoneId} no encontrado`);
      }

      // 2. Validar permisos
      if (!this.permissions.canManageMilestones(user, milestone.project)) {
        throw new ForbiddenException('No tenés permisos para asociar tareas a este hito');
      }

      // 3. Validar existencia de la tarea con bloqueo pesimista (FOR UPDATE)
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!task) {
        throw new NotFoundException(`Tarea con id ${taskId} no encontrada`);
      }

      // 4. Validar pertenencia al mismo proyecto
      if (task.projectId !== milestone.projectId) {
        throw new BadRequestException('La tarea pertenece a otro proyecto distinto al del hito');
      }

      // 5. Validar que la tarea no esté archivada
      if (task.archivedAt !== null) {
        throw new BadRequestException('No se puede asociar una tarea archivada a un hito');
      }

      // 7. Validar pertenencia previa
      // Caso 7a: Idempotente si ya pertenece a este mismo hito
      if (task.milestoneId === milestone.id) {
        const stats = await this.getTaskStatsForMilestones([milestone.id], manager);
        const stat = stats.get(milestone.id) ?? { taskCount: 0, completedTaskCount: 0 };
        return this.toSummaryDto(milestone, stat.taskCount, stat.completedTaskCount);
      }

      // Caso 7b: Conflicto 409 si pertenece a otro hito activo
      if (task.milestoneId) {
        const otherMilestone = await manager.findOne(MilestoneEntity, {
          where: { id: task.milestoneId, deletedAt: IsNull() },
        });

        if (otherMilestone) {
          throw new ConflictException(
            `La tarea ya se encuentra asociada a otro hito activo ("${otherMilestone.name}"). Desasociala primero para poder reasignarla`,
          );
        }
      }

      // 8. Asociar la tarea de forma atómica (solo modifica milestoneId)
      await manager.update(TaskEntity, taskId, { milestoneId: milestone.id });

      const stats = await this.getTaskStatsForMilestones([milestone.id], manager);
      const stat = stats.get(milestone.id) ?? {
        taskCount: 1,
        completedTaskCount: task.status === TaskStatus.COMPLETED ? 1 : 0,
      };

      // 9. Sincronizar estado de finalización automática del hito
      await syncMilestoneAutoCompletionWithManager(manager, milestone.id, stat, milestone);

      return this.toSummaryDto(milestone, stat.taskCount, stat.completedTaskCount);
    });
  }

  /**
   * Desasocia una tarea de un Milestone de forma transaccional e idempotente (KAN-245).
   * - Desvincula tareas y subtareas sin modificar el vínculo de su tarea principal.
   * - Sincroniza el estado de finalización automática del hito tras desasociar la tarea.
   */
  async disassociateTask(
    milestoneId: string,
    taskId: string,
    user: RequestUser,
  ): Promise<MilestoneSummaryDto> {
    return this.milestoneRepo.manager.transaction(async (manager) => {
      // 1. Validar existencia y estado activo del Milestone
      const milestone = await manager.findOne(MilestoneEntity, {
        where: { id: milestoneId, deletedAt: IsNull() },
        relations: ['project', 'creator', 'completedBy'],
      });

      if (!milestone) {
        throw new NotFoundException(`Milestone con id ${milestoneId} no encontrado`);
      }

      // 2. Validar permisos
      if (!this.permissions.canManageMilestones(user, milestone.project)) {
        throw new ForbiddenException('No tenés permisos para desasociar tareas de este hito');
      }

      // 3. Validar existencia de la tarea con bloqueo pesimista (FOR UPDATE)
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!task) {
        throw new NotFoundException(`Tarea con id ${taskId} no encontrada`);
      }

      // 4. Validar relación de la tarea con este hito
      if (task.milestoneId !== milestone.id) {
        if (!task.milestoneId) {
          // Idempotente: la tarea ya no está asociada a ningún hito
          const stats = await this.getTaskStatsForMilestones([milestone.id], manager);
          const stat = stats.get(milestone.id) ?? { taskCount: 0, completedTaskCount: 0 };
          return this.toSummaryDto(milestone, stat.taskCount, stat.completedTaskCount);
        }
        // La tarea está asociada a otro hito diferente
        throw new BadRequestException('La tarea no está asociada a este hito');
      }

      // 5. Desasociar la tarea estableciendo milestone_id = null
      await manager.update(TaskEntity, taskId, { milestoneId: null });

      const stats = await this.getTaskStatsForMilestones([milestone.id], manager);
      const stat = stats.get(milestone.id) ?? { taskCount: 0, completedTaskCount: 0 };

      // 6. Sincronizar estado de finalización automática del hito
      await syncMilestoneAutoCompletionWithManager(manager, milestone.id, stat, milestone);

      return this.toSummaryDto(milestone, stat.taskCount, stat.completedTaskCount);
    });
  }

  private async getTaskStatsForMilestones(
    milestoneIds: string[],
    manager?: EntityManager,
  ): Promise<Map<string, { taskCount: number; completedTaskCount: number }>> {
    if (milestoneIds.length === 0) return new Map();

    const repo = manager ? manager.getRepository(TaskEntity) : this.taskRepo;
    const statsRaw: Array<{ milestoneId: string; taskCount: string; completedTaskCount: string }> =
      await repo
        .createQueryBuilder('t')
        .select('t.milestoneId', 'milestoneId')
        .addSelect('COUNT(t.id)', 'taskCount')
        .addSelect(`COUNT(CASE WHEN t.status = :completedStatus THEN 1 END)`, 'completedTaskCount')
        .where('t.milestoneId IN (:...milestoneIds)', { milestoneIds })
        .andWhere(MILESTONE_PROGRESS_TASK_PREDICATE)
        .andWhere('t.archivedAt IS NULL')
        .setParameter('completedStatus', TaskStatus.COMPLETED)
        .groupBy('t.milestoneId')
        .getRawMany();

    const statsMap = new Map<string, { taskCount: number; completedTaskCount: number }>();
    for (const row of statsRaw) {
      statsMap.set(row.milestoneId, {
        taskCount: parseInt(row.taskCount, 10) || 0,
        completedTaskCount: parseInt(row.completedTaskCount, 10) || 0,
      });
    }
    return statsMap;
  }

  private async getSubtaskStatsForParentTasks(
    parentTaskIds: string[],
  ): Promise<Map<string, { subtaskCount: number; completedSubtaskCount: number }>> {
    if (parentTaskIds.length === 0) return new Map();

    const qb = this.taskRepo.createQueryBuilder('sub');
    if (typeof qb?.select !== 'function' || typeof qb?.getRawMany !== 'function') {
      return new Map();
    }

    const rows: Array<{ parentTaskId: string; subtaskCount: string; completedSubtaskCount: string }> =
      (await qb
        .select('sub.parentTaskId', 'parentTaskId')
        .addSelect('COUNT(sub.id)', 'subtaskCount')
        .addSelect(`COUNT(CASE WHEN sub.status = :completedStatus THEN 1 END)`, 'completedSubtaskCount')
        .where('sub.parentTaskId IN (:...parentTaskIds)', { parentTaskIds })
        .andWhere('sub.archivedAt IS NULL')
        .setParameter('completedStatus', TaskStatus.COMPLETED)
        .groupBy('sub.parentTaskId')
        .getRawMany()) ?? [];

    const map = new Map<string, { subtaskCount: number; completedSubtaskCount: number }>();
    for (const row of rows) {
      if (row.parentTaskId) {
        map.set(row.parentTaskId, {
          subtaskCount: parseInt(row.subtaskCount, 10) || 0,
          completedSubtaskCount: parseInt(row.completedSubtaskCount, 10) || 0,
        });
      }
    }
    return map;
  }

  private computeStatus(dueDate: string, completedAt: Date | string | null): MilestoneStatus {
    if (completedAt) {
      return 'COMPLETED';
    }
    const today = new Date().toISOString().slice(0, 10);
    return dueDate < today ? 'OVERDUE' : 'PENDING';
  }

  private computeProgress(taskCount: number, completedTaskCount: number): number {
    if (taskCount === 0) return 0;
    return Math.round((completedTaskCount / taskCount) * 100);
  }

  private mapUser(user: any): MilestoneUserDto | undefined {
    if (!user) return undefined;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl ?? null,
    };
  }

  private toSummaryDto(
    milestone: MilestoneEntity,
    taskCount: number,
    completedTaskCount: number,
  ): MilestoneSummaryDto {
    const dueDateStr =
      typeof milestone.dueDate === 'string'
        ? milestone.dueDate
        : (milestone.dueDate as any)?.toISOString?.().split('T')[0] || String(milestone.dueDate);

    return {
      id: milestone.id,
      projectId: milestone.projectId,
      name: milestone.name,
      description: milestone.description ?? null,
      dueDate: dueDateStr,
      completedAt: milestone.completedAt ? milestone.completedAt.toISOString() : null,
      completedById: milestone.completedById ?? null,
      completedBy: milestone.completedBy ? this.mapUser(milestone.completedBy) : null,
      createdBy: milestone.createdBy,
      creator: milestone.creator ? this.mapUser(milestone.creator) : undefined,
      createdAt: milestone.createdAt instanceof Date ? milestone.createdAt.toISOString() : String(milestone.createdAt),
      updatedAt: milestone.updatedAt instanceof Date ? milestone.updatedAt.toISOString() : String(milestone.updatedAt),
      status: this.computeStatus(dueDateStr, milestone.completedAt),
      taskCount,
      completedTaskCount,
      progress: this.computeProgress(taskCount, completedTaskCount),
    };
  }

  private toDetailDto(
    milestone: MilestoneEntity,
    tasks: TaskEntity[],
    taskCount: number,
    completedTaskCount: number,
    subtaskStatsMap?: Map<string, { subtaskCount: number; completedSubtaskCount: number }>,
  ): MilestoneDetailDto {
    const summary = this.toSummaryDto(milestone, taskCount, completedTaskCount);

    const taskDtos: MilestoneTaskDto[] = tasks.map((t) => {
      const subStats = subtaskStatsMap?.get(t.id);
      return {
        id: t.id,
        title: t.title,
        slug: t.slug,
        status: t.status,
        priority: t.priority,
        startDate: t.startDate ?? null,
        dueDate: t.dueDate ?? null,
        parentTaskId: t.parentTaskId ?? null,
        parentTaskTitle: t.parentTask?.title ?? null,
        assignedTo: t.assignedTo
          ? {
              id: t.assignedTo.id,
              name: t.assignedTo.name,
              email: t.assignedTo.email,
              avatarUrl: t.assignedTo.avatarUrl ?? null,
            }
          : null,
        assignedToId: t.assignedToId ?? t.assignedTo?.id ?? null,
        createdBy: t.createdBy,
        ...(subStats
          ? {
              subtaskCount: subStats.subtaskCount,
              completedSubtaskCount: subStats.completedSubtaskCount,
            }
          : {}),
      };
    });

    return {
      ...summary,
      tasks: taskDtos,
    };
  }
}
