import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { BudgetEntity } from '../database/entities/budget.entity';
import { BudgetItemEntity } from '../database/entities/budget-item.entity';
import { CostEntity } from '../database/entities/cost.entity';
import { CostCategoryEntity } from '../database/entities/cost-category.entity';
import { AuthModule } from '../auth/auth.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module'
import { GanttModule } from '../gantt/gantt.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaskEntity,
      ProjectEntity,
      ProjectStatusHistoryEntity,
      BudgetEntity,
      BudgetItemEntity,
      CostEntity,
      CostCategoryEntity,
    ]),
    AuthModule,
    UsersModule,
    ProjectsModule,
    GanttModule,
  ],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}