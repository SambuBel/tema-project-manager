import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubtaskEntity } from './subtask.entity';
import { TaskEntity } from '../tasks/task.entity';
import { CreateSubtaskDto } from './dto/create-subtask.dto';
import { UpdateSubtaskDto } from './dto/update-subtask.dto';

@Injectable()
export class SubtasksService {
  constructor(
    @InjectRepository(SubtaskEntity)
    private readonly subtaskRepo: Repository<SubtaskEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
  ) {}

  async findByTask(taskId: string): Promise<SubtaskEntity[]> {
    // Verificar que la tarea existe
    const task = await this.taskRepo.findOneBy({ id: taskId });
    if (!task) throw new NotFoundException('Tarea no encontrada');

    return this.subtaskRepo.find({
      where: { taskId },
      relations: ['assignedTo'],
      order: { createdAt: 'ASC' },
    });
  }

  async create(
    taskId: string,
    dto: CreateSubtaskDto,
    userId: string,
  ): Promise<SubtaskEntity> {
    const task = await this.taskRepo.findOneBy({ id: taskId });
    if (!task) throw new NotFoundException('Tarea no encontrada');

    const subtask = this.subtaskRepo.create({
      taskId,
      title: dto.title,
      assignedToId: dto.assignedToId ?? null,
    });

    const saved = await this.subtaskRepo.save(subtask);
    return this.subtaskRepo.findOneOrFail({
      where: { id: saved.id },
      relations: ['assignedTo'],
    });
  }

  async update(subtaskId: string, dto: UpdateSubtaskDto): Promise<SubtaskEntity> {
    const subtask = await this.subtaskRepo.findOneBy({ id: subtaskId });
    if (!subtask) throw new NotFoundException('Subtarea no encontrada');

    Object.assign(subtask, dto);
    await this.subtaskRepo.save(subtask);

    return this.subtaskRepo.findOneOrFail({
      where: { id: subtaskId },
      relations: ['assignedTo'],
    });
  }

  async remove(subtaskId: string): Promise<void> {
    const subtask = await this.subtaskRepo.findOneBy({ id: subtaskId });
    if (!subtask) throw new NotFoundException('Subtarea no encontrada');

    await this.subtaskRepo.remove(subtask);
  }

  async countPending(taskId: string): Promise<number> {
    return this.subtaskRepo.count({
      where: { taskId, completed: false },
    });
  }
}