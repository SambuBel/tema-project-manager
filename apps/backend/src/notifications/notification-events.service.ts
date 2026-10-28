import { Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './notification-type';

export interface TaskRef {
  id: string;
  title: string;
  projectId: string;
}

/**
 * Eventos de dominio que generan notificaciones (RF-NO-01 y RF-CO-02).
 * Los demás módulos llaman a estos métodos y no conocen el detalle de la notificación.
 * Un fallo acá NUNCA debe romper la acción principal (crear tarea, comentar...): se registra y se sigue.
 */
@Injectable()
export class NotificationEventsService {
  private readonly logger = new Logger(NotificationEventsService.name);

  constructor(private readonly notifications: NotificationsService) {}

  /** Te asignaron una tarea (al crearla o al cambiar el responsable). No avisa si te la asignaste vos. */
  async taskAssigned(p: {
    task: TaskRef;
    assigneeId: string | null | undefined;
    actorId: string;
    actorName: string;
  }): Promise<void> {
    if (!p.assigneeId || p.assigneeId === p.actorId) return;
    try {
      await this.notifications.create({
        userId: p.assigneeId,
        type: NotificationType.TASK_ASSIGNED,
        title: 'Te asignaron una tarea',
        message: p.actorName + ' te asignó la tarea "' + p.task.title + '".',
        projectId: p.task.projectId,
        taskId: p.task.id,
      });
    } catch (err) {
      this.logger.warn('No se pudo generar la notificación de asignación: ' + String(err));
    }
  }

  /**
   * Se comentó una tarea. Los mencionados reciben COMMENT_MENTION; el responsable y quien creó la
   * tarea reciben TASK_COMMENTED (salvo el autor del comentario y los ya mencionados, para no duplicar).
   */
  async commentCreated(p: {
    task: TaskRef & { assignedToId?: string | null; createdBy?: string | null };
    authorId: string;
    authorName: string;
    mentionedUserIds?: string[];
  }): Promise<void> {
    try {
      const mentioned = [...new Set(p.mentionedUserIds ?? [])].filter((id) => id !== p.authorId);
      if (mentioned.length > 0) {
        await this.notifications.createForUsers(mentioned, {
          type: NotificationType.COMMENT_MENTION,
          title: 'Te mencionaron en un comentario',
          message: p.authorName + ' te mencionó en un comentario de la tarea "' + p.task.title + '".',
          projectId: p.task.projectId,
          taskId: p.task.id,
        });
      }

      const owners = [p.task.assignedToId, p.task.createdBy].filter(
        (id): id is string => !!id && id !== p.authorId && !mentioned.includes(id),
      );
      await this.notifications.createForUsers(owners, {
        type: NotificationType.TASK_COMMENTED,
        title: 'Nuevo comentario en tu tarea',
        message: p.authorName + ' comentó la tarea "' + p.task.title + '".',
        projectId: p.task.projectId,
        taskId: p.task.id,
      });
    } catch (err) {
      this.logger.warn('No se pudo generar la notificación de comentario: ' + String(err));
    }
  }
}