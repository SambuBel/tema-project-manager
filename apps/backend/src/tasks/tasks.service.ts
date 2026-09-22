import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEntity } from './task.entity';
import { TaskPriority, TaskStatus } from '../database/enums';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { FilterTasksDto } from './dto/filter-tasks.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly repo: Repository<TaskEntity>,
  ) {}

  create(dto: CreateTaskDto): Promise<TaskEntity> {
    const task = new TaskEntity();
    task.projectId = dto.projectId;
    task.title = dto.title;
    task.description = dto.description ?? null;
    task.status = dto.status ?? TaskStatus.PENDING;
    task.priority = dto.priority ?? TaskPriority.MEDIUM;
    task.assignedToId = dto.assignedToId ?? null;
    task.startDate = dto.startDate ?? null;
    task.dueDate = dto.dueDate ?? null;

    return this.repo.save(task);
  }

  async findAllByProject(filters: FilterTasksDto): Promise<TaskEntity[]> {
    const qb = this.repo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignedTo', 'assignedTo')
      .leftJoinAndSelect('task.project', 'project')
      .where('task.projectId = :projectId', { projectId: filters.projectId });
 
    if (filters.status) {
      qb.andWhere('task.status = :status', { status: filters.status });
    }
 
    if (filters.priority) {
      qb.andWhere('task.priority = :priority', { priority: filters.priority });
    }
 
    if (filters.assignedToId) {
      qb.andWhere('task.assignedToId = :assignedToId', {
        assignedToId: filters.assignedToId,
      });
    }
 
    if (filters.search) {
      qb.andWhere(
        '(task.title ILIKE :search OR task.description ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }
 
    return qb.orderBy('task.createdAt', 'DESC').getMany();
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

  async update(id: string, dto: UpdateTaskDto): Promise<TaskEntity> {
    const task = await this.findOne(id);

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

  async remove(id: string): Promise<void> {
    const result = await this.repo.delete({ id });

    if (!result.affected) {
      throw new NotFoundException(`Task ${id} no encontrada`);
    }
  }
}
