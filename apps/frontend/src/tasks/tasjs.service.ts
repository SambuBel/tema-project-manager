import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEntity } from './task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly tasksRepo: Repository<TaskEntity>,
  ) {}

  async create(dto: CreateTaskDto): Promise<TaskEntity> {
    const task = this.tasksRepo.create({
      ...dto,
      status: 'PENDING',
    });
    return this.tasksRepo.save(task);
  }

  async findAllByProject(projectId: string): Promise<TaskEntity[]> {
    return this.tasksRepo.find({
      where: { projectId },
      relations: ['assignedTo'],
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(id: string): Promise<TaskEntity> {
    const task = await this.tasksRepo.findOne({
      where: { id },
      relations: ['assignedTo', 'project'],
    });
    if (!task) throw new NotFoundException(`Tarea ${id} no encontrada`);
    return task;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<TaskEntity> {
    const task = await this.findOne(id);
    Object.assign(task, dto);
    return this.tasksRepo.save(task);
  }

  async remove(id: string): Promise<void> {
    const task = await this.findOne(id);
    await this.tasksRepo.remove(task);
  }
}