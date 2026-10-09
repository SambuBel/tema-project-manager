import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubtaskEntity } from './subtask.entity';
import { TaskEntity } from '../tasks/task.entity';
import { SubtasksService } from './subtasks.service';
import { SubtasksController } from './subtasks.controller';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubtaskEntity, TaskEntity]),
    AuthModule,
    UsersModule,
  ],
  controllers: [SubtasksController],
  providers: [SubtasksService],
  exports: [SubtasksService],
})
export class SubtasksModule {}