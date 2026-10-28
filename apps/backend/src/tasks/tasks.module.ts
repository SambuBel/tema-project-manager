import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from './task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { CommentEntity } from '../database/entities/comment.entity';
import { CommentMentionEntity } from '../database/entities/comment-mention.entity';
import { ProjectsModule } from '../projects/projects.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { SubtaskEntity } from '../subtasks/subtask.entity';
import { TaskSlugHistoryEntity } from './task-slug-history.entity';
import { NotificationsModule } from '../notifications/notifications.module';


@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaskEntity,
      ProjectEntity,
      CommentEntity,
      CommentMentionEntity,
      SubtaskEntity,
      TaskSlugHistoryEntity,
    ]),
    UsersModule,
    AuthModule,
    ProjectsModule,
    NotificationsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
