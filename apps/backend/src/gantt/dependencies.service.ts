import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TaskDependencyEntity } from '../database/entities/task-dependency.entity';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { DependencyType } from '../database/enums';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateDependencyDto } from './dto/create-dependency.dto';
import { UpdateDependencyDto } from './dto/update-dependency.dto';
import { CascadePreviewDto } from './dto/cascade-preview.dto';
import type { CascadeImpact, CascadePreviewResponse } from '@tema/shared-types';

/**
 * CRUD de dependencias entre tareas (RF-GA-03, RF-GA-04).
 * Autorización: canManageTaskPlanning (ADMIN / PROGRAM_MANAGER / líder real).
 * Valida que ambas tareas pertenezcan al proyecto y detecta ciclos antes de crear.
 */
@Injectable()
export class DependenciesService {
  constructor(
    @InjectRepository(TaskDependencyEntity)
    private readonly depRepo: Repository<TaskDependencyEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    private readonly permissions: PermissionsService,
  ) {}

  async create(projectId: string, dto: CreateDependencyDto, user: RequestUser): Promise<TaskDependencyEntity> {
    const project = await this.findProjectOrFail(projectId);
    this.assertCanPlan(user, project);

    // No puede depender de sí misma
    if (dto.predecessorTaskId === dto.successorTaskId) {
      throw new BadRequestException('Una tarea no puede depender de sí misma.');
    }

    // Ambas tareas deben existir y pertenecer al proyecto
    const [predecessor, successor] = await Promise.all([
      this.taskRepo.findOneBy({ id: dto.predecessorTaskId, projectId }),
      this.taskRepo.findOneBy({ id: dto.successorTaskId, projectId }),
    ]);
    if (!predecessor) throw new NotFoundException('Tarea predecesora no encontrada en este proyecto.');
    if (!successor) throw new NotFoundException('Tarea sucesora no encontrada en este proyecto.');

    const type = dto.dependencyType ?? DependencyType.FINISH_START;

    // No duplicar la misma dependencia exacta
    const existing = await this.depRepo.findOneBy({
      predecessorTaskId: dto.predecessorTaskId,
      successorTaskId: dto.successorTaskId,
      dependencyType: type,
    });
    if (existing) throw new ConflictException('Esta dependencia ya existe.');

    // RF-GA-03: detectar ciclos
    const wouldCycle = await this.detectCycle(dto.predecessorTaskId, dto.successorTaskId, projectId);
    if (wouldCycle) {
      throw new BadRequestException('No se puede crear la dependencia: generaría un ciclo.');
    }

    const dependency = this.depRepo.create({
      predecessorTaskId: dto.predecessorTaskId,
      successorTaskId: dto.successorTaskId,
      dependencyType: type,
      createdBy: user.id,
    });
    return this.depRepo.save(dependency);
  }

  async update(projectId: string, dependencyId: string, dto: UpdateDependencyDto, user: RequestUser): Promise<TaskDependencyEntity> {
    const { dependency } = await this.findDepAndAuthorize(projectId, dependencyId, user);
    dependency.dependencyType = dto.dependencyType;
    return this.depRepo.save(dependency);
  }

  async remove(projectId: string, dependencyId: string, user: RequestUser): Promise<void> {
    const { dependency } = await this.findDepAndAuthorize(projectId, dependencyId, user);
    await this.depRepo.remove(dependency);
  }

    // ── Cascade ──────────────────────────────────────────────

  async previewCascade(
    projectId: string,
    dto: CascadePreviewDto,
    user: RequestUser,
  ): Promise<CascadePreviewResponse> {
    const project = await this.findProjectOrFail(projectId);
    this.assertCanPlan(user, project);

    const task = await this.taskRepo.findOneBy({ id: dto.taskId, projectId });
    if (!task) throw new NotFoundException('Tarea no encontrada en este proyecto.');
    if (!task.dueDate) {
      throw new BadRequestException('La tarea no tiene fecha de vencimiento; no se puede calcular cascada.');
    }

    const deltaDays = this.daysBetween(task.dueDate, dto.newDueDate);
    if (deltaDays === 0) return { deltaDays: 0, affected: [] };

    const affected = await this.computeCascade(projectId, dto.taskId, deltaDays);
    return { deltaDays, affected };
  }

  async applyCascade(
    projectId: string,
    dto: CascadePreviewDto,
    user: RequestUser,
  ): Promise<CascadePreviewResponse> {
    const project = await this.findProjectOrFail(projectId);
    this.assertCanPlan(user, project);

    const task = await this.taskRepo.findOneBy({ id: dto.taskId, projectId });
    if (!task) throw new NotFoundException('Tarea no encontrada en este proyecto.');
    if (!task.dueDate) {
      throw new BadRequestException('La tarea no tiene fecha de vencimiento; no se puede aplicar cascada.');
    }

    const deltaDays = this.daysBetween(task.dueDate, dto.newDueDate);
    if (deltaDays === 0) return { deltaDays: 0, affected: [] };

    const affected = await this.computeCascade(projectId, dto.taskId, deltaDays);

    await this.taskRepo.manager.transaction(async (manager) => {
      // Actualizar la tarea movida
      await manager.update(TaskEntity, task.id, {
        startDate: dto.newStartDate,
        dueDate: dto.newDueDate,
      });

      // Actualizar todas las sucesoras transitivas
      for (const impact of affected) {
        const updates: Record<string, string> = {};
        if (impact.newStartDate) updates.startDate = impact.newStartDate;
        if (impact.newDueDate) updates.dueDate = impact.newDueDate;
        if (Object.keys(updates).length > 0) {
          await manager.update(TaskEntity, impact.taskId, updates);
        }
      }
    });

    return { deltaDays, affected };
  }

  // ── helpers privados ──────────────────────────────────────────────────

  private async findProjectOrFail(projectId: string): Promise<ProjectEntity> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
    return project;
  }

  private assertCanPlan(user: RequestUser, project: ProjectEntity): void {
    if (!this.permissions.canManageTaskPlanning(user, project)) {
      throw new ForbiddenException('No tenés permiso para gestionar dependencias en este proyecto.');
    }
  }

  /**
   * Busca la dependencia y verifica que pertenece al proyecto y que el usuario puede planificar.
   */
  private async findDepAndAuthorize(projectId: string, dependencyId: string, user: RequestUser) {
    const project = await this.findProjectOrFail(projectId);
    this.assertCanPlan(user, project);

    const dependency = await this.depRepo.findOne({
      where: { id: dependencyId },
      relations: ['predecessorTask', 'successorTask'],
    });
    if (!dependency) throw new NotFoundException('Dependencia no encontrada.');

    if (
      dependency.predecessorTask.projectId !== projectId ||
      dependency.successorTask.projectId !== projectId
    ) {
      throw new NotFoundException('Dependencia no encontrada en este proyecto.');
    }

    return { dependency, project };
  }

  /**
   * RF-GA-03 — Detección de ciclos: al agregar predecessor → successor, verificamos
   * que no exista ya un camino successor → ... → predecessor en el grafo. BFS desde
   * successor siguiendo aristas hacia adelante; si llegamos a predecessor, hay ciclo.
   */
  private async detectCycle(predecessorId: string, successorId: string, projectId: string): Promise<boolean> {
    const allDeps = await this.depRepo
      .createQueryBuilder('dep')
      .innerJoin('dep.predecessorTask', 'pred')
      .innerJoin('dep.successorTask', 'succ')
      .where('pred.projectId = :projectId', { projectId })
      .andWhere('succ.projectId = :projectId', { projectId })
      .select(['dep.predecessorTaskId', 'dep.successorTaskId'])
      .getMany();

    // Grafo de adyacencia: predecessor → [successor, ...]
    const adjacency = new Map<string, string[]>();
    for (const dep of allDeps) {
      const neighbors = adjacency.get(dep.predecessorTaskId) ?? [];
      neighbors.push(dep.successorTaskId);
      adjacency.set(dep.predecessorTaskId, neighbors);
    }

    // BFS desde successorId: ¿llegamos a predecessorId?
    const visited = new Set<string>();
    const queue = [successorId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === predecessorId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }

    return false;
  }

    /**
   * RF-GA-10 — BFS para calcular el impacto en cascada. Solo sigue dependencias FINISH_START
   * (si la predecesora termina más tarde, las sucesoras deben correrse). Recorre todas las
   * sucesoras transitivas de movedTaskId y les aplica deltaDays a sus fechas.
   */
  private async computeCascade(
    projectId: string,
    movedTaskId: string,
    deltaDays: number,
  ): Promise<CascadeImpact[]> {
    const allDeps = await this.depRepo
      .createQueryBuilder('dep')
      .innerJoin('dep.predecessorTask', 'pred')
      .innerJoin('dep.successorTask', 'succ')
      .where('pred.projectId = :projectId', { projectId })
      .andWhere('succ.projectId = :projectId', { projectId })
      .andWhere('pred.archivedAt IS NULL')
      .andWhere('succ.archivedAt IS NULL')
      .andWhere('dep.dependencyType = :type', { type: DependencyType.FINISH_START })
      .select(['dep.predecessorTaskId', 'dep.successorTaskId'])
      .getMany();

    // Grafo de adyacencia: predecessor → [successors]
    const adjacency = new Map<string, string[]>();
    for (const dep of allDeps) {
      const neighbors = adjacency.get(dep.predecessorTaskId) ?? [];
      neighbors.push(dep.successorTaskId);
      adjacency.set(dep.predecessorTaskId, neighbors);
    }

    // BFS desde movedTaskId (no se incluye a sí misma en affected)
    const visited = new Set<string>([movedTaskId]);
    const queue = [movedTaskId];
    const affectedIds: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          affectedIds.push(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (affectedIds.length === 0) return [];

    const tasks = await this.taskRepo.findBy({ id: In(affectedIds) });
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    return affectedIds
      .map((id) => taskMap.get(id))
      .filter((t): t is TaskEntity => !!t)
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        currentStartDate: t.startDate,
        currentDueDate: t.dueDate,
        newStartDate: t.startDate ? this.shiftDate(t.startDate, deltaDays) : null,
        newDueDate: t.dueDate ? this.shiftDate(t.dueDate, deltaDays) : null,
      }));
  }

  /** Calcula la diferencia en días entre dos fechas YYYY-MM-DD. */
  private daysBetween(dateA: string, dateB: string): number {
    const a = new Date(dateA + 'T00:00:00Z');
    const b = new Date(dateB + 'T00:00:00Z');
    return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  }

  /** Suma deltaDays a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD. */
  private shiftDate(dateStr: string, deltaDays: number): string {
    const date = new Date(dateStr + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + deltaDays);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}