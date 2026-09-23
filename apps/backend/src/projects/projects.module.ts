import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from './project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { UserEntity } from '../database/entities/user.entity';
import { ProjectActivityEntity } from '../database/entities/project-activity.entity';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectActivityService } from './project-activity.service';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module'; // Fixed absolute path if any

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectEntity, 
      ProjectMemberEntity, 
      UserEntity, 
      ProjectActivityEntity, 
      ProjectStatusHistoryEntity
    ]),
    UsersModule, 
    AuthModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectActivityService],
  exports: [ProjectActivityService],
})
export class ProjectsModule {}
