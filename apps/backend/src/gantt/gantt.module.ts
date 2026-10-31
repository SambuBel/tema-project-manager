import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { TaskDependencyEntity } from '../database/entities/task-dependency.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { GanttController } from './gantt.controller';
import { GanttService } from './gantt.service';
import { DependenciesController } from './dependencies.controller';
import { DependenciesService } from './dependencies.service';

@Module({
  imports: [TypeOrmModule.forFeature([TaskEntity, ProjectEntity, TaskDependencyEntity]), AuthModule, UsersModule],
  controllers: [GanttController, DependenciesController],
  providers: [GanttService, DependenciesService],
  exports: [GanttService],
})
export class GanttModule {}
