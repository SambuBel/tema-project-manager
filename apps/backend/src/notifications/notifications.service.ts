import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { NotificationEntity } from '../database/entities/notification.entity';
import { NotificationPreferenceEntity } from '../database/entities/notification-preference.entity';
import { NotificationChannel } from '../database/enums';
import { NotificationType } from './notification-type';
import { ListNotificationsDto } from './list-notifications.dto';

/** Datos para generar una notificación. Lo usan los demás módulos (tareas, comentarios, etc.). */
export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  projectId?: string | null;
  taskId?: string | null;
}

/** Forma que ve el frontend (sin la relación con el usuario). */
export interface NotificationView {
  id: string;
  type: string;
  title: string;
  message: string;
  projectId: string | null;
  taskId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsPage {
  items: NotificationView[];
  total: number;
  unreadCount: number;
}

export interface NotificationPreferenceView {
  type: NotificationType;
  enabled: boolean;
}

const DEFAULT_LIMIT = 20;

function toView(n: NotificationEntity): NotificationView {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    projectId: n.projectId,
    taskId: n.taskId,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

/**
 * Persistencia, generación y consulta de notificaciones IN_APP.
 * Cada usuario solo ve y modifica las suyas: todas las consultas filtran por userId.
 * Al generar, se respetan las preferencias del usuario (RF-NO-04).
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notifications: Repository<NotificationEntity>,
    @InjectRepository(NotificationPreferenceEntity)
    private readonly preferences: Repository<NotificationPreferenceEntity>,
  ) {}

  /** De los usuarios dados, los que NO desactivaron este tipo de notificación. */
  private async usersWithTypeEnabled(userIds: string[], type: NotificationType): Promise<string[]> {
    if (userIds.length === 0) return [];
    const disabled = await this.preferences.find({
      where: { userId: In(userIds), type, enabled: false },
    });
    const blocked = new Set(disabled.map((p) => p.userId));
    return userIds.filter((id) => !blocked.has(id));
  }

  /** Genera una notificación. Devuelve null si el usuario desactivó ese tipo. */
  async create(input: CreateNotificationInput): Promise<NotificationView | null> {
    const [allowed] = await this.usersWithTypeEnabled([input.userId], input.type);
    if (!allowed) return null;

    const entity = this.notifications.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      channel: NotificationChannel.IN_APP,
    });
    return toView(await this.notifications.save(entity));
  }

  /** Genera la misma notificación para varios destinatarios (sin repetir y respetando preferencias). */
  async createForUsers(
    userIds: string[],
    data: Omit<CreateNotificationInput, 'userId'>,
  ): Promise<number> {
    const unique = [...new Set(userIds)];
    const recipients = await this.usersWithTypeEnabled(unique, data.type);
    if (recipients.length === 0) return 0;

    const entities = recipients.map((userId) =>
      this.notifications.create({
        userId,
        type: data.type,
        title: data.title,
        message: data.message,
        projectId: data.projectId ?? null,
        taskId: data.taskId ?? null,
        channel: NotificationChannel.IN_APP,
      }),
    );
    await this.notifications.save(entities);
    return entities.length;
  }

  /** Listado del usuario, de la más nueva a la más vieja. */
  async findForUser(userId: string, query: ListNotificationsDto): Promise<NotificationsPage> {
    const where = {
      userId,
      channel: NotificationChannel.IN_APP,
      ...(query.unreadOnly ? { readAt: IsNull() } : {}),
    };

    const [rows, total] = await this.notifications.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: query.limit ?? DEFAULT_LIMIT,
      skip: query.offset ?? 0,
    });

    return {
      items: rows.map(toView),
      total,
      unreadCount: await this.countUnread(userId),
    };
  }

  async countUnread(userId: string): Promise<number> {
    return this.notifications.count({
      where: { userId, channel: NotificationChannel.IN_APP, readAt: IsNull() },
    });
  }

  /** Marca una como leída. Si no es del usuario responde 404 (no revela que existe). */
  async markAsRead(id: string, userId: string): Promise<NotificationView> {
    const notification = await this.notifications.findOne({ where: { id, userId } });
    if (!notification) {
      throw new NotFoundException('Notificación ' + id + ' no encontrada');
    }
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notifications.save(notification);
    }
    return toView(notification);
  }

  /** Marca como leídas todas las pendientes del usuario. */
  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notifications.update(
      { userId, channel: NotificationChannel.IN_APP, readAt: IsNull() },
      { readAt: new Date() },
    );
    return { updated: result.affected ?? 0 };
  }

  /** Preferencias del usuario para TODOS los tipos (los que no tocó están activados). */
  async getPreferences(userId: string): Promise<NotificationPreferenceView[]> {
    const rows = await this.preferences.find({ where: { userId } });
    const byType = new Map(rows.map((r) => [r.type, r.enabled]));
    return Object.values(NotificationType).map((type) => ({
      type,
      enabled: byType.get(type) ?? true,
    }));
  }

  /** Guarda las preferencias enviadas y devuelve el estado completo. */
  async updatePreferences(
    userId: string,
    items: NotificationPreferenceView[],
  ): Promise<NotificationPreferenceView[]> {
    if (items.length > 0) {
      await this.preferences.upsert(
        items.map((i) => ({ userId, type: i.type, enabled: i.enabled })),
        ['userId', 'type'],
      );
    }
    return this.getPreferences(userId);
  }
}