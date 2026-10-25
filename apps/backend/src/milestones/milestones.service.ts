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

    // Consulta agregada única para calcular contadores de tareas asociadas sin N+1
    const statsMap = await this.getTaskStatsForMilestones(milestones.map((m) => m.id));

    return milestones.map((m) => {
      const stats = statsMap.get(m.id) ?? { taskCount: 0, completedTaskCount: 0 };
      return this.toSummaryDto(m, stats.taskCount, stats.completedTaskCount);
    });
  }

  /**
   * Consulta el detalle de un Milestone con sus tareas asociadas activas (KAN-243).
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

    // Traer tareas asociadas activas (excluyendo archivadas)
    const tasks = await this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignedTo', 'assignedTo')
      .where('task.milestoneId = :id', { id })
      .andWhere('task.archivedAt IS NULL')
      .orderBy('task.dueDate', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'ASC')
      .getMany();

    const taskCount = tasks.length;
    const completedTaskCount = tasks.filter((t) => t.status === TaskStatus.COMPLETED).length;

    return this.toDetailDto(milestone, tasks, taskCount, completedTaskCount);
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
   * Marca manualmente un Milestone como completado (KAN-244 - Fase 4).
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

    if (!milestone.completedAt) {
      milestone.completedAt = new Date();
      milestone.completedById = user.id;
      await this.milestoneRepo.save(milestone);
      milestone.completedBy = { id: user.id, name: user.name, email: user.email } as any;
    }

    const stats = await this.getTaskStatsForMilestones([milestone.id]);
    const stat = stats.get(milestone.id) ?? { taskCount: 0, completedTaskCount: 0 };
    return this.toSummaryDto(milestone, stat.taskCount, stat.completedTaskCount);
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
   * Asocia una tarea a un Milestone de forma transaccional e idempotente (KAN-245).
   * - Valida existencia del hito (activo) y permisos de administración.
   * - Valida existencia de la tarea, que no esté archivada y pertenezca al mismo proyecto.
   * - Si ya está asociada al mismo hito, es idempotente (retorna resumen sin cambios).
   * - Si está asociada a otro hito activo, responde 409 Conflict sin reasignar silenciosamente.
   * - Preserva intactos todos los demás campos de la tarea.
   * - Retorna el resumen del Milestone con métricas actualizadas.
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

      // 6. Validar pertenencia previa
      // Caso 6a: Idempotente si ya pertenece a este mismo hito
      if (task.milestoneId === milestone.id) {
        const stats = await this.getTaskStatsForMilestones([milestone.id], manager);
        const stat = stats.get(milestone.id) ?? { taskCount: 0, completedTaskCount: 0 };
        return this.toSummaryDto(milestone, stat.taskCount, stat.completedTaskCount);
      }

      // Caso 6b: Conflicto 409 si pertenece a otro hito activo
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

      // 7. Asociar la tarea de forma atómica (solo modifica milestoneId)
      await manager.update(TaskEntity, taskId, { milestoneId: milestone.id });

      const stats = await this.getTaskStatsForMilestones([milestone.id], manager);
      const stat = stats.get(milestone.id) ?? { taskCount: 0, completedTaskCount: 0 };
      return this.toSummaryDto(milestone, stat.taskCount, stat.completedTaskCount);
    });
  }

  /**
   * Desasocia una tarea de un Milestone de forma transaccional e idempotente (KAN-245).
   * - Valida existencia del hito (activo) y permisos.
   * - Valida existencia de la tarea.
   * - Si la tarea ya no está asociada a ningún hito, es idempotente.
   * - Si la tarea está vinculada a OTRO hito, rechaza la operación para no desasociar por error.
   * - Establece tasks.milestone_id = null sin borrar la tarea.
   * - Retorna el resumen del Milestone con métricas actualizadas.
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
  ): MilestoneDetailDto {
    const summary = this.toSummaryDto(milestone, taskCount, completedTaskCount);

    const taskDtos: MilestoneTaskDto[] = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      slug: t.slug,
      status: t.status,
      priority: t.priority,
      startDate: t.startDate ?? null,
      dueDate: t.dueDate ?? null,
      parentTaskId: t.parentTaskId ?? null,
      assignedTo: t.assignedTo
        ? {
            id: t.assignedTo.id,
            name: t.assignedTo.name,
            email: t.assignedTo.email,
            avatarUrl: t.assignedTo.avatarUrl ?? null,
          }
        : null,
    }));

    return {
      ...summary,
      tasks: taskDtos,
    };
  }
}
