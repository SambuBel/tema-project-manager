import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { AuthModule } from '../auth/auth.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskEntity, ProjectEntity, ProjectStatusHistoryEntity]),
    AuthModule, // provee PermissionsService
    UsersModule,
  ],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}