import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEntity } from './task.entity';
import { TaskPriority, TaskStatus } from '../database/enums';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { BadRequestException } from '@nestjs/common';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import {
  isValidTransition,
  TASK_STATUS_LABELS,
  VALID_TRANSITIONS,
} from './task-transitions';

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

  async update(id: string, dto: UpdateTaskDto): Promise<TaskEntity> {
    const task = await this.findOne(id);
    if (dto.status !== undefined && dto.status !== task.status) {
      this.validateTransition(task.status, dto.status);
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

    return this.repo.save(task);
  }

  async remove(id: string): Promise<void> {
    const result = await this.repo.delete({ id });

    if (!result.affected) {
      throw new NotFoundException(`Task ${id} no encontrada`);
    }
  }

    /**
   * Cambia el estado de una tarea validando la transición.
   * Endpoint dedicado: PATCH /tasks/:id/status
   */
  async updateStatus(id: string, dto: UpdateTaskStatusDto): Promise<TaskEntity> {
    const task = await this.findOne(id);

    if (task.status === dto.status) {
      return task;
    }

    this.validateTransition(task.status, dto.status);

    task.status = dto.status;
    return this.repo.save(task);
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
