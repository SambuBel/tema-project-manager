import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { ProjectsModule } from '../projects/projects.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { CostsModule } from '../costs/costs.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiToolsService } from './ai-tools.service';
import { GeminiClient } from './gemini.client';

@Module({
  imports: [TasksModule, ProjectsModule, AuthModule, UsersModule, BudgetsModule, CostsModule],
  controllers: [AiController],
  providers: [AiService, AiToolsService, GeminiClient],
})
export class AiModule {}
