import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from './task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { CommentEntity } from '../database/entities/comment.entity';
import { ProjectsModule } from '../projects/projects.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([TaskEntity, ProjectEntity, CommentEntity]), UsersModule, AuthModule, ProjectsModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
