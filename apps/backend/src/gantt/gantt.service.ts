import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { TaskDependencyEntity } from '../database/entities/task-dependency.entity';
import { DependencyType, TaskStatus } from '../database/enums';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { GanttResponseDto, GanttTaskDto } from './dto/gantt-response.dto';

/**
 * Read model del Gantt: una sola respuesta con proyecto, tareas (raíz + subtareas, sin archivadas)
 * y dependencias. Solo LEE; las reglas de negocio de planificación (dependencias, fechas, cascada)
 * van en endpoints propios, no acá. Autorización: canViewProject (ver el Gantt = ver el proyecto).
 */
@Injectable()
export class GanttService {
  constructor(
    @InjectRepository(TaskEntity) private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(TaskDependencyEntity) private readonly dependencyRepo: Repository<TaskDependencyEntity>,
    private readonly permissions: PermissionsService,
  ) {}

  async getGantt(projectId: string, user: RequestUser): Promise<GanttResponseDto> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    if (!(await this.permissions.canViewProject(user, project))) {
      throw new ForbiddenException('No tenés acceso a este proyecto.');
    }

    const tasks = await this.findTasks(projectId);
    const dependencies = await this.findDependencies(projectId);
    const blockedTaskIds = this.computeBlockedTaskIds(tasks, dependencies);

    return {
      project: {
        id: project.id,
        name: project.name,
        startDate: project.startDate,
        estimatedEndDate: project.estimatedEndDate,
      },
      tasks: tasks.map((task) => this.toTaskDto(task, blockedTaskIds.has(task.id))),
      dependencies: dependencies.map((dep) => ({
        id: dep.id,
        predecessorTaskId: dep.predecessorTaskId,
        successorTaskId: dep.successorTaskId,
        type: 'FINISH_TO_START',
      })),
    };
  }

  /**
   * Tareas raíz Y subtareas del proyecto (a diferencia de GET /tasks, que solo trae raíces), sin
   * archivadas. Orden: fecha de inicio (las sin planificar al final) y, a igual fecha, antigüedad.
   * El árbol padre/hijo lo arma el cliente con parentTaskId, así que acá no hace falta agrupar.
   */
  private findTasks(projectId: string): Promise<TaskEntity[]> {
    return this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignedTo', 'assignedTo')
      .where('task.projectId = :projectId', { projectId })
      .andWhere('task.archivedAt IS NULL')
      .orderBy('task.startDate', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'ASC')
      .getMany();
  }

  /**
   * Dependencias FINISH_START cuyos DOS extremos son tareas de ESTE proyecto y no están archivadas.
   * Se filtra por ambos lados: la tabla no impide a nivel SQL que una dependencia cruce proyectos.
   */
  private findDependencies(projectId: string): Promise<TaskDependencyEntity[]> {
    return this.dependencyRepo
      .createQueryBuilder('dep')
      .innerJoin('dep.predecessorTask', 'pred')
      .innerJoin('dep.successorTask', 'succ')
      .where('pred.projectId = :projectId', { projectId })
      .andWhere('succ.projectId = :projectId', { projectId })
      .andWhere('pred.archivedAt IS NULL')
      .andWhere('succ.archivedAt IS NULL')
      .andWhere('dep.dependencyType = :type', { type: DependencyType.FINISH_START })
      .orderBy('dep.createdAt', 'ASC')
      .getMany();
  }

  /**
   * blocked es DERIVADO (nunca se guarda ni toca Task.status): una tarea está bloqueada si tiene al
   * menos una predecesora fin-inicio que no está COMPLETED. Con varias predecesoras basta una
   * incompleta. Las dependencias ya vienen filtradas (sin archivadas ni de otros proyectos).
   */
  private computeBlockedTaskIds(tasks: TaskEntity[], dependencies: TaskDependencyEntity[]): Set<string> {
    const statusById = new Map(tasks.map((task) => [task.id, task.status]));
    const blocked = new Set<string>();
    for (const dep of dependencies) {
      const predecessorStatus = statusById.get(dep.predecessorTaskId);
      if (predecessorStatus !== undefined && predecessorStatus !== TaskStatus.COMPLETED) {
        blocked.add(dep.successorTaskId);
      }
    }
    return blocked;
  }

  private toTaskDto(task: TaskEntity, blocked: boolean): GanttTaskDto {
    return {
      id: task.id,
      parentTaskId: task.parentTaskId,
      title: task.title,
      status: task.status,
      priority: task.priority,
      startDate: task.startDate,
      dueDate: task.dueDate,
      assignedTo: task.assignedTo ? { id: task.assignedTo.id, name: task.assignedTo.name } : null,
      blocked,
    };
  }
}
