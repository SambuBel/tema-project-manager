import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationEntity } from '../database/entities/notification.entity';
import { NotificationPreferenceEntity } from '../database/entities/notification-preference.entity';
import { BudgetEntity } from '../database/entities/budget.entity';
import { CostEntity } from '../database/entities/cost.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { ProjectEntity } from '../projects/project.entity';
import { TaskEntity } from '../tasks/task.entity';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationEventsService } from './notification-events.service';
import { TaskDueSoonService } from './task-due-soon.service';
import { ProjectAlertsService } from './project-alerts.service';
import { NotificationJobsService } from './notification-jobs.service';

/**
 * Módulo de notificaciones. Exporta NotificationEventsService (eventos de dominio) y
 * NotificationsService (crear/consultar) para que tareas, comentarios, proyectos, etc.
 * generen notificaciones sin conocer el detalle de la persistencia.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationEntity,
      NotificationPreferenceEntity,
      BudgetEntity,
      CostEntity,
      UserRoleEntity,
      ProjectEntity,
      TaskEntity,
    ]),
    AuthModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationEventsService,
    TaskDueSoonService,
    ProjectAlertsService,
    NotificationJobsService,
  ],
  exports: [NotificationsService, NotificationEventsService],
})
export class NotificationsModule {}