import { Repository } from 'typeorm';
import { BudgetEntity } from '../database/entities/budget.entity';
import { CostEntity } from '../database/entities/cost.entity';
import { NotificationEntity } from '../database/entities/notification.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { ProjectStatus } from '../database/enums';
import { ProjectEntity } from '../projects/project.entity';
import { TaskEntity } from '../tasks/task.entity';
import { NotificationsService } from './notifications.service';
import { ProjectAlertsService } from './project-alerts.service';
import { NotificationType } from './notification-type';

describe('ProjectAlertsService budget alerts', () => {
  function build() {
    const project = {
      id: 'project-id',
      name: 'Proyecto de prueba',
      leaderId: 'leader-id',
      status: ProjectStatus.IN_PROGRESS,
      archivedAt: null,
      startDate: null,
      estimatedEndDate: null,
    };
    const projects = {
      find: jest.fn().mockResolvedValue([project]),
      findOne: jest.fn().mockResolvedValue(project),
    };
    const tasks = {};
    const budgets = {
      findOne: jest.fn().mockResolvedValue({ totalAmount: '1500.00', currency: 'USD' }),
    };
    const costQuery = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ sum: '999999.00' }),
    };
    const costs = { createQueryBuilder: jest.fn().mockReturnValue(costQuery) };
    const roleQuery = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ userId: 'program-manager-id' }]),
    };
    const userRoles = { createQueryBuilder: jest.fn().mockReturnValue(roleQuery) };
    const notifs = { find: jest.fn().mockResolvedValue([]) };
    const notifications = { createForUsers: jest.fn().mockResolvedValue(2) };
    const service = new ProjectAlertsService(
      projects as unknown as Repository<ProjectEntity>,
      tasks as unknown as Repository<TaskEntity>,
      budgets as unknown as Repository<BudgetEntity>,
      costs as unknown as Repository<CostEntity>,
      userRoles as unknown as Repository<UserRoleEntity>,
      notifs as unknown as Repository<NotificationEntity>,
      notifications as unknown as NotificationsService,
    );

    return { service, projects, budgets, costQuery, notifs, notifications };
  }

  it('notifica inmediatamente a líder y Program Manager al superar el umbral con USD 999.999/USD 1.500', async () => {
    const { service, notifications, costQuery } = build();

    await service.checkBudgetAfterCostChange('project-id');

    expect(costQuery.andWhere).toHaveBeenCalledWith('c.currency = :currency', { currency: 'USD' });
    expect(notifications.createForUsers).toHaveBeenCalledWith(
      ['leader-id', 'program-manager-id'],
      expect.objectContaining({
        type: NotificationType.BUDGET_THRESHOLD,
        title: 'Ejecución presupuestaria: superó el 100%',
        message: 'El proyecto "Proyecto de prueba" ejecutó el 66667% de su presupuesto.',
        projectId: 'project-id',
      }),
    );
  });

  it('la evaluación periódica también detecta el umbral presupuestario', async () => {
    const { service, notifications } = build();

    await expect(service.run()).resolves.toMatchObject({ budgetAlerts: 2 });

    expect(notifications.createForUsers).toHaveBeenCalledWith(
      ['leader-id', 'program-manager-id'],
      expect.objectContaining({ type: NotificationType.BUDGET_THRESHOLD }),
    );
  });
});
