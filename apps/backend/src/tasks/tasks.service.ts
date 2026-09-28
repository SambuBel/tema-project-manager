import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TaskEntity } from './task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { UserEntity } from '../database/entities/user.entity';
import { TaskPriority, TaskStatus } from '../database/enums';
import { UsersService } from '../users/users.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UserEntity } from '../database/entities/user.entity';
import { ProjectActivityService } from '../projects/project-activity.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly repo: Repository<TaskEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ProjectMemberEntity)
    private readonly projectMemberRepo: Repository<ProjectMemberEntity>,
    private readonly usersService: UsersService,
  ) {}

  /** Lider del proyecto, o miembro activo (project_members sin removedAt). */
  private async isProjectMember(project: ProjectEntity, userId: string): Promise<boolean> {
    if (project.leaderId === userId) {
      return true;
    }
    return this.projectMemberRepo.existsBy({ projectId: project.id, userId, removedAt: IsNull() });
  }

  /**
   * El lider del proyecto siempre puede tocar sus tareas; cualquier otro usuario necesita
   * ser miembro activo. Mismo criterio que ya usa ProjectsService para las acciones
   * restringidas al lider. 404 si el proyecto no existe (evita filtrar existencia con un
   * 403 distinto para proyectos inexistentes).
   */
  private async assertProjectMember(projectId: string, userId: string): Promise<ProjectEntity> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    if (!(await this.isProjectMember(project, userId))) {
      throw new ForbiddenException('No sos miembro de este proyecto');
    }
    return project;
  }

  /**
   * El responsable de una tarea tiene que existir (404 si no, evita un 500 por FK) y ser
   * lider o miembro activo del MISMO proyecto de la tarea (400 si no: a diferencia de
   * "no sos miembro", esto no es sobre quien hace el pedido sino sobre a quien se asigna).
   */
  private async assertAssigneeIsProjectMember(project: ProjectEntity, assigneeId: string): Promise<void> {
    const assignee = await this.usersService.findById(assigneeId);
    if (!assignee) {
      throw new NotFoundException(`El usuario responsable ${assigneeId} no existe`);
    }
    if (!(await this.isProjectMember(project, assigneeId))) {
      throw new BadRequestException('El responsable debe ser miembro del proyecto');
    }
  }

  /**
   * Crea una tarea dentro de un proyecto. El usuario tiene que ser lider o miembro activo
   * del proyecto (404 si el proyecto no existe) y, si se indica responsable, ese usuario
   * tambien tiene que existir y pertenecer al mismo proyecto. `createdBy` sale del usuario
   * autenticado.
   */
  async create(dto: CreateTaskDto, user: UserEntity): Promise<TaskEntity> {
    const project = await this.assertProjectMember(dto.projectId, user.id);

    if (dto.assignedToId) {
      await this.assertAssigneeIsProjectMember(project, dto.assignedToId);
    }

    const task = new TaskEntity();
    task.projectId = dto.projectId;
    task.title = dto.title;
    task.description = dto.description ?? null;
    task.status = dto.status ?? TaskStatus.PENDING;
    task.priority = dto.priority ?? TaskPriority.MEDIUM;
    task.assignedToId = dto.assignedToId ?? null;
    task.startDate = dto.startDate ?? null;
    task.dueDate = dto.dueDate ?? null;
    task.createdBy = user.id;

    return this.repo.save(task);
  }

  findAllByProject(projectId: string): Promise<TaskEntity[]> {
    return this.repo.find({
      where: { projectId },
      relations: ['assignedTo', 'project'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<TaskEntity> {
    const task = await this.repo.findOne({
      where: { id },
      relations: ['project', 'assignedTo'],
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} no encontrada`);
    }

    return task;
  }

  async update(id: string, dto: UpdateTaskDto, user: UserEntity): Promise<TaskEntity> {
    const task = await this.findOne(id);
    const project = await this.assertProjectMember(task.projectId, user.id);

    if (dto.assignedToId) {
      await this.assertAssigneeIsProjectMember(project, dto.assignedToId);
    }

    Object.assign(task, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.assignedToId !== undefined ? { assignedToId: dto.assignedToId ?? null } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate ?? null } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ?? null } : {}),
    });

      const updatedTask = await manager.save(task);

      await this.activityService.logEvent({
        projectId: updatedTask.projectId,
        actorId: user.id,
        actionType: ProjectActivityAction.TASK_UPDATED,
        entityType: ProjectActivityEntityType.TASK,
        entityId: updatedTask.id,
        metadata: { changes, prevStatus, newStatus: updatedTask.status, title: task.title },
      }, manager);

      return updatedTask;
    });
  }

  async remove(id: string, user: UserEntity): Promise<void> {
    const task = await this.findOne(id);
    await this.assertProjectMember(task.projectId, user.id);

    await this.repo.delete({ id: task.id });
  }

  /** Idempotente: archivar una tarea ya archivada no hace nada (mismo criterio que ProjectsService.archive). */
  async archive(id: string, user: UserEntity): Promise<TaskEntity> {
    const task = await this.findOne(id);
    await this.assertProjectMember(task.projectId, user.id);

    if (task.archivedAt) {
      return task;
    }

    task.archivedAt = new Date();
    return this.repo.save(task);
  }
}
