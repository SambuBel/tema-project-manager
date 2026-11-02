import { Logger } from '@nestjs/common';
import { NotificationEventsService } from './notification-events.service';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './notification-type';

const task = { id: 't1', title: 'Informe', projectId: 'p1' };

function build() {
  const create = jest.fn().mockResolvedValue(undefined);
  const service = new NotificationEventsService({ create } as unknown as NotificationsService);
  return { service, create };
}

describe('NotificationEventsService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  describe('taskStatusChanged (CU-06)', () => {
    const event = { task, leaderId: 'leader', statusLabel: 'En revisión', actorId: 'carla', actorName: 'Carla' };

    it('avisa al líder con la tarea y el estado nuevo', async () => {
      const { service, create } = build();

      await service.taskStatusChanged(event);

      expect(create).toHaveBeenCalledWith({
        userId: 'leader',
        type: NotificationType.TASK_STATUS_CHANGED,
        title: 'Cambió el estado de una tarea',
        message: 'Carla pasó la tarea "Informe" a En revisión.',
        projectId: 'p1',
        taskId: 't1',
      });
    });

    it.each([
      ['el cambio lo hizo el líder', { actorId: 'leader' }],
      ['el proyecto no tiene líder', { leaderId: null }],
    ])('no avisa si %s', async (_name, override) => {
      const { service, create } = build();

      await service.taskStatusChanged({ ...event, ...override });

      expect(create).not.toHaveBeenCalled();
    });

    it('si falla la notificación no tira error', async () => {
      const { service, create } = build();
      create.mockRejectedValue(new Error('sin base'));

      await expect(service.taskStatusChanged(event)).resolves.toBeUndefined();
    });
  });

  describe('projectMemberAdded (CU-01)', () => {
    const event = { project: { id: 'p1', name: 'Onboarding' }, memberUserId: 'camilo', actorId: 'lucia', actorName: 'Lucía' };

    it('avisa al miembro nuevo', async () => {
      const { service, create } = build();

      await service.projectMemberAdded(event);

      expect(create).toHaveBeenCalledWith({
        userId: 'camilo',
        type: NotificationType.PROJECT_MEMBER_ADDED,
        title: 'Te agregaron a un proyecto',
        message: 'Lucía te agregó al proyecto "Onboarding".',
        projectId: 'p1',
      });
    });

    it('no avisa si se agregó a sí mismo', async () => {
      const { service, create } = build();

      await service.projectMemberAdded({ ...event, actorId: 'camilo' });

      expect(create).not.toHaveBeenCalled();
    });

    it('si falla la notificación no tira error', async () => {
      const { service, create } = build();
      create.mockRejectedValue(new Error('sin base'));

      await expect(service.projectMemberAdded(event)).resolves.toBeUndefined();
    });
  });
});
