import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from './project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { UserEntity } from '../database/entities/user.entity';
import { ProjectActivityEntity } from '../database/entities/project-activity.entity';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { ProjectSlugHistoryEntity } from './project-slug-history.entity';
import { ProjectsController } from './projects.controller';
import { ProjectInvitationsDevController } from './project-invitations-dev.controller';
import { NonProductionGuard } from './non-production.guard';
import { ProjectsService } from './projects.service';
import { ProjectActivityService } from './project-activity.service';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectEntity, 
      ProjectMemberEntity, 
      UserEntity, 
      ProjectActivityEntity, 
      ProjectStatusHistoryEntity,
      ProjectSlugHistoryEntity,
    ]),
    UsersModule, 
    AuthModule,
  ],
  controllers: [ProjectsController, ProjectInvitationsDevController],
  providers: [ProjectsService, ProjectActivityService, NonProductionGuard],
  exports: [ProjectActivityService],
})
export class ProjectsModule {}
