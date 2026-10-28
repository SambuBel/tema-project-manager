import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEntity } from '../tasks/task.entity';
import { NotificationEntity } from '../database/entities/notification.entity';
import { TaskStatus } from '../database/enums';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './notification-type';
import { DUE_SOON_DAYS } from './notifications.config';

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD en hora local del servidor (las fechas de tarea son DATE, sin hora). */
function toDateString(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + month + '-' + day;
}

function dueLabel(dueDate: string, today: string): string {
  const diff = Math.round((Date.parse(dueDate) - Date.parse(today)) / DAY_MS);
  if (diff <= 0) return 'vence hoy';
  if (diff === 1) return 'vence mañana';
  return 'vence el ' + dueDate.split('-').reverse().join('/');
}

/**
 * RF-NO-01: avisa al responsable cuando una tarea suya está por vencer.
 * Una sola notificación por tarea y responsable (no se repite cada hora).
 * No incluye tareas completadas ni archivadas, ni las que ya vencieron.
 */
@Injectable()
export class TaskDueSoonService {
  private readonly logger = new Logger(TaskDueSoonService.name);

  constructor(
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(NotificationEntity) private readonly notifs: Repository<NotificationEntity>,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now: Date = new Date()): Promise<number> {
    const today = toDateString(now);
    const limit = toDateString(new Date(now.getTime() + DUE_SOON_DAYS * DAY_MS));

    const dueTasks = await this.tasks
      .createQueryBuilder('t')
      .where('t.assignedToId IS NOT NULL')
      .andWhere('t.archivedAt IS NULL')
      .andWhere('t.status <> :done', { done: TaskStatus.COMPLETED })
      .andWhere('t.dueDate BETWEEN :today AND :limit', { today, limit })
      .getMany();

    let created = 0;
    for (const task of dueTasks) {
      if (!task.assignedToId || !task.dueDate) continue;

      const already = await this.notifs.count({
        where: { userId: task.assignedToId, taskId: task.id, type: NotificationType.TASK_DUE_SOON },
      });
      if (already > 0) continue;

      const result = await this.notifications.create({
        userId: task.assignedToId,
        type: NotificationType.TASK_DUE_SOON,
        title: 'Tarea por vencer',
        message: 'La tarea "' + task.title + '" ' + dueLabel(task.dueDate, today) + '.',
        projectId: task.projectId,
        taskId: task.id,
      });
      if (result) created += 1;
    }

    if (created > 0) this.logger.log('Notificaciones de vencimiento generadas: ' + created);
    return created;
  }
}