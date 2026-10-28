import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { ProjectEntity } from '../projects/project.entity';
import { TaskEntity } from '../tasks/task.entity';
import { BudgetEntity } from '../database/entities/budget.entity';
import { CostEntity } from '../database/entities/cost.entity';
import { NotificationEntity } from '../database/entities/notification.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { ProjectStatus, RoleName } from '../database/enums';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './notification-type';
import { BUDGET_THRESHOLDS, RED_ALERT_REPEAT_DAYS, RED_DEVIATION_POINTS } from './notifications.config';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Avance esperado (0-100) según el tiempo transcurrido entre inicio y fin estimado. */
function expectedProgress(startDate: string, endDate: string, now: Date): number {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (!(end > start)) return 0;
  const ratio = (now.getTime() - start) / (end - start);
  return Math.min(Math.max(ratio, 0), 1) * 100;
}

/**
 * RF-NO-02 y RF-CT-11: avisa al Líder del proyecto y a los Program Manager cuando
 * (a) la ejecución presupuestaria supera un umbral o (b) el proyecto entra en desvío rojo.
 * Las reglas (umbrales, puntos de desvío) están en notifications.config.ts.
 */
@Injectable()
export class ProjectAlertsService {
  private readonly logger = new Logger(ProjectAlertsService.name);

  constructor(
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(BudgetEntity) private readonly budgets: Repository<BudgetEntity>,
    @InjectRepository(CostEntity) private readonly costs: Repository<CostEntity>,
    @InjectRepository(UserRoleEntity) private readonly userRoles: Repository<UserRoleEntity>,
    @InjectRepository(NotificationEntity) private readonly notifs: Repository<NotificationEntity>,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now: Date = new Date()): Promise<{ budgetAlerts: number; redAlerts: number }> {
    const projects = await this.projects.find({
      where: { status: ProjectStatus.IN_PROGRESS, archivedAt: IsNull() },
    });
    if (projects.length === 0) return { budgetAlerts: 0, redAlerts: 0 };

    const managers = await this.programManagerIds();
    let budgetAlerts = 0;
    let redAlerts = 0;

    for (const project of projects) {
      const recipients = [...new Set([project.leaderId, ...managers])];
      budgetAlerts += await this.checkBudget(project, recipients);
      redAlerts += await this.checkRedDeviation(project, recipients, now);
    }

    if (budgetAlerts + redAlerts > 0) {
      this.logger.log('Alertas de proyecto generadas: presupuesto ' + budgetAlerts + ', desvío rojo ' + redAlerts);
    }
    return { budgetAlerts, redAlerts };
  }

  private async programManagerIds(): Promise<string[]> {
    const rows = await this.userRoles
      .createQueryBuilder('ur')
      .innerJoin('ur.role', 'r')
      .where('r.name = :name', { name: RoleName.PROGRAM_MANAGER })
      .select('ur.userId', 'userId')
      .getRawMany<{ userId: string }>();
    return rows.map((r) => r.userId);
  }

  /** Ejecución = costos del proyecto en la moneda del presupuesto vigente / total presupuestado. */
  private async checkBudget(project: ProjectEntity, recipients: string[]): Promise<number> {
    const budget = await this.budgets.findOne({ where: { projectId: project.id, isCurrent: true } });
    const total = budget ? Number(budget.totalAmount) : 0;
    if (!budget || !(total > 0)) return 0;

    const row = await this.costs
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.amount), 0)', 'sum')
      .where('c.projectId = :projectId', { projectId: project.id })
      .andWhere('c.currency = :currency', { currency: budget.currency })
      .getRawOne<{ sum: string }>();

    const percent = (Number(row?.sum ?? 0) / total) * 100;
    const reached = BUDGET_THRESHOLDS.filter((t) => percent >= t);
    if (reached.length === 0) return 0;

    const threshold = Math.max(...reached);
    return this.notifyOnce(
      project.id,
      recipients,
      NotificationType.BUDGET_THRESHOLD,
      'Ejecución presupuestaria: superó el ' + threshold + '%',
      'El proyecto "' + project.name + '" ejecutó el ' + Math.round(percent) + '% de su presupuesto.',
    );
  }

  /** Desvío = avance esperado por calendario - avance real (tareas completadas / tareas activas). */
  private async checkRedDeviation(project: ProjectEntity, recipients: string[], now: Date): Promise<number> {
    if (!project.startDate || !project.estimatedEndDate) return 0;

    const expected = expectedProgress(project.startDate, project.estimatedEndDate, now);
    if (expected <= 0) return 0;

    const stats = await this.tasks
      .createQueryBuilder('t')
      .select('COUNT(t.id)', 'total')
      .addSelect("SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END)", 'completed')
      .where('t.projectId = :projectId', { projectId: project.id })
      .andWhere('t.archivedAt IS NULL')
      .getRawOne<{ total: string; completed: string | null }>();

    const total = Number(stats?.total ?? 0);
    if (total === 0) return 0;

    const actual = (Number(stats?.completed ?? 0) / total) * 100;
    const deviation = expected - actual;
    if (deviation < RED_DEVIATION_POINTS) return 0;

    const since = new Date(now.getTime() - RED_ALERT_REPEAT_DAYS * DAY_MS);
    return this.notifyOnce(
      project.id,
      recipients,
      NotificationType.PROJECT_RED_ALERT,
      'Proyecto en desvío rojo',
      'El proyecto "' + project.name + '" lleva ' + Math.round(actual) + '% de avance contra ' +
        Math.round(expected) + '% esperado (desvío de ' + Math.round(deviation) + ' puntos).',
      since,
    );
  }

  /** Genera la notificación solo para quienes no la recibieron ya (con el mismo título, y desde la fecha indicada si se pasa). */
  private async notifyOnce(
    projectId: string,
    recipients: string[],
    type: NotificationType,
    title: string,
    message: string,
    since?: Date,
  ): Promise<number> {
    const existing = await this.notifs.find({
      where: {
        projectId,
        type,
        title,
        userId: In(recipients),
        ...(since ? { createdAt: MoreThanOrEqual(since) } : {}),
      },
      select: ['id', 'userId'],
    });
    const already = new Set(existing.map((e) => e.userId));
    const fresh = recipients.filter((id) => !already.has(id));
    return this.notifications.createForUsers(fresh, { type, title, message, projectId });
  }
}