import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectSlugHistoryEntity } from '../projects/project-slug-history.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ResourceAllocationsController } from './resource-allocations.controller';
import { ResourceAllocationsService } from './resource-allocations.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity, ProjectSlugHistoryEntity]), AuthModule, UsersModule],
  controllers: [ResourceAllocationsController],
  providers: [ResourceAllocationsService],
})
export class ResourceAllocationsModule {}
