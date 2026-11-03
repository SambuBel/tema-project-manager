import { Repository } from 'typeorm';
import { NotificationPreferenceEntity } from '../database/entities/notification-preference.entity';
import { NotificationEntity } from '../database/entities/notification.entity';
import { UserEntity } from '../database/entities/user.entity';
import { NotificationChannel } from '../database/enums';
import { EmailNotificationService } from './email-notification.service';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './notification-type';

describe('NotificationsService email delivery', () => {
  function build(emailEnabled: boolean) {
    const notifications = {
      create: jest.fn((input: Record<string, unknown>) => input),
      save: jest.fn(async (entity: Record<string, unknown>) => ({
        ...entity,
        id: 'notification-id',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        readAt: null,
      })),
    };
    const preferences = { find: jest.fn().mockResolvedValue([]) };
    const users = {
      find: jest.fn().mockResolvedValue([{ id: 'user-id', email: 'user@example.com' }]),
    };
    const emailNotifications = {
      isEnabledFor: jest.fn().mockReturnValue(emailEnabled),
      send: jest.fn().mockResolvedValue(undefined),
    };

    const service = new NotificationsService(
      notifications as unknown as Repository<NotificationEntity>,
      preferences as unknown as Repository<NotificationPreferenceEntity>,
      users as unknown as Repository<UserEntity>,
      emailNotifications as unknown as EmailNotificationService,
    );

    return { service, notifications, users, emailNotifications };
  }

  it('guarda notificación in-app y envía el email habilitado por tipo', async () => {
    const { service, notifications, users, emailNotifications } = build(true);

    await service.create({
      userId: 'user-id',
      type: NotificationType.TASK_ASSIGNED,
      title: 'Te asignaron una tarea',
      message: 'Revisá el presupuesto.',
      projectId: 'project-id',
      taskId: 'task-id',
    });

    expect(notifications.save).toHaveBeenCalledTimes(2);
    expect(notifications.save.mock.calls[0]?.[0]?.channel).toBe(NotificationChannel.IN_APP);
    expect(emailNotifications.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Te asignaron una tarea',
      text: 'Revisá el presupuesto.',
    });
    expect(users.find).toHaveBeenCalledWith({
      where: expect.objectContaining({ active: true }),
      select: ['id', 'email'],
    });
  });

  it('no envía email para tipos excluidos de la configuración', async () => {
    const { service, notifications, users, emailNotifications } = build(false);

    await service.create({
      userId: 'user-id',
      type: NotificationType.TASK_STATUS_CHANGED,
      title: 'Cambió el estado',
      message: 'La tarea pasó a revisión.',
    });

    expect(notifications.save).toHaveBeenCalledTimes(1);
    expect(users.find).not.toHaveBeenCalled();
    expect(emailNotifications.send).not.toHaveBeenCalled();
  });
});
