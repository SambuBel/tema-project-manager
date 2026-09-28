import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

  /**
   * El lider del proyecto siempre puede tocar sus tareas; cualquier otro usuario necesita
   * ser miembro activo (project_members sin removedAt). Mismo criterio que ya usa
   * ProjectsService para las acciones restringidas al lider. 404 si el proyecto no existe
   * (evita filtrar existencia con un 403 distinto para proyectos inexistentes).
   */
  private async assertProjectMember(projectId: string, userId: string): Promise<ProjectEntity> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    if (project.leaderId === userId) {
      return project;
    }

    const isMember = await this.projectMemberRepo.existsBy({ projectId, userId, removedAt: IsNull() });
    if (!isMember) {
      throw new ForbiddenException('No sos miembro de este proyecto');
    }
    return project;
  }

  /**
   * Crea una tarea dentro de un proyecto. El usuario tiene que ser lider o miembro activo
   * del proyecto (404 si el proyecto no existe) y, si se indica responsable, ese usuario
   * tambien tiene que existir (404 si no): asi el cliente recibe un error claro en vez de
   * un 500 por violacion de foreign key. `createdBy` sale del usuario autenticado.
   */
  async create(dto: CreateTaskDto, user: UserEntity): Promise<TaskEntity> {
    await this.assertProjectMember(dto.projectId, user.id);

    if (dto.assignedToId) {
      const assignee = await this.usersService.findById(dto.assignedToId);
      if (!assignee) {
        throw new NotFoundException(`El usuario responsable ${dto.assignedToId} no existe`);
      }
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
    await this.assertProjectMember(task.projectId, user.id);

    Object.assign(task, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.assignedToId !== undefined ? { assignedToId: dto.assignedToId ?? null } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate ?? null } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ?? null } : {}),
    });

    return this.repo.save(task);
  }

  async remove(id: string, user: UserEntity): Promise<void> {
    const task = await this.findOne(id);
    await this.assertProjectMember(task.projectId, user.id);

    await this.repo.delete({ id: task.id });
  }
}
