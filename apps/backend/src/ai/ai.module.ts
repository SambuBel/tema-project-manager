import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [TasksModule, AuthModule, UsersModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
