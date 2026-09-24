import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TaskEntity } from './task.entity';
import { TaskPriority, TaskStatus, ProjectActivityAction, ProjectActivityEntityType } from '../database/enums';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UserEntity } from '../database/entities/user.entity';
import { ProjectActivityService } from '../projects/project-activity.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly repo: Repository<TaskEntity>,
    private readonly dataSource: DataSource,
    private readonly activityService: ProjectActivityService,
  ) {}

  async create(dto: CreateTaskDto, user: UserEntity): Promise<TaskEntity> {
    return this.dataSource.transaction(async (manager) => {
      const task = manager.create(TaskEntity, {
        projectId: dto.projectId,
        title: dto.title,
        description: dto.description ?? null,
        status: dto.status ?? TaskStatus.PENDING,
        priority: dto.priority ?? TaskPriority.MEDIUM,
        assignedToId: dto.assignedToId ?? null,
        startDate: dto.startDate ?? null,
        dueDate: dto.dueDate ?? null,
      });

      const savedTask = await manager.save(task);

      await this.activityService.logEvent({
        projectId: savedTask.projectId,
        actorId: user.id,
        actionType: ProjectActivityAction.TASK_CREATED,
        entityType: ProjectActivityEntityType.TASK,
        entityId: savedTask.id,
        metadata: { title: savedTask.title, status: savedTask.status },
      }, manager);

      return savedTask;
    });
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
    return this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, { where: { id } });
      if (!task) {
        throw new NotFoundException(`Task ${id} no encontrada`);
      }

      const prevStatus = task.status;
      const changes: Record<string, { old: any, new: any }> = {};

      if (dto.title !== undefined && dto.title !== task.title) {
        changes.title = { old: task.title, new: dto.title };
        task.title = dto.title;
      }
      if (dto.description !== undefined && dto.description !== task.description) {
        changes.description = { old: task.description, new: dto.description };
        task.description = dto.description ?? null;
      }
      if (dto.status !== undefined && dto.status !== task.status) {
        changes.status = { old: task.status, new: dto.status };
        task.status = dto.status;
      }
      if (dto.priority !== undefined && dto.priority !== task.priority) {
        changes.priority = { old: task.priority, new: dto.priority };
        task.priority = dto.priority;
      }
      if (dto.assignedToId !== undefined && dto.assignedToId !== task.assignedToId) {
        changes.assignedToId = { old: task.assignedToId, new: dto.assignedToId };
        task.assignedToId = dto.assignedToId ?? null;
      }
      if (dto.startDate !== undefined && dto.startDate !== task.startDate) {
        changes.startDate = { old: task.startDate, new: dto.startDate };
        task.startDate = dto.startDate ?? null;
      }
      if (dto.dueDate !== undefined && dto.dueDate !== task.dueDate) {
        changes.dueDate = { old: task.dueDate, new: dto.dueDate };
        task.dueDate = dto.dueDate ?? null;
      }

      if (Object.keys(changes).length === 0) {
        return task;
      }

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
    return this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, { where: { id } });
      if (!task) {
        throw new NotFoundException(`Task ${id} no encontrada`);
      }

      await this.activityService.logEvent({
        projectId: task.projectId,
        actorId: user.id,
        actionType: ProjectActivityAction.TASK_DELETED,
        entityType: ProjectActivityEntityType.TASK,
        entityId: task.id,
        metadata: { title: task.title },
      }, manager);

      const result = await manager.delete(TaskEntity, { id });
      if (!result.affected) {
        throw new NotFoundException(`Task ${id} no encontrada`);
      }
    });
  }
}
