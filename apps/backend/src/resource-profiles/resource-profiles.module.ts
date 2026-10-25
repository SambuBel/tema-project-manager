import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ResourceProfilesController } from './resource-profiles.controller';
import { ResourceProfilesService } from './resource-profiles.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [ResourceProfilesController],
  providers: [ResourceProfilesService],
})
export class ResourceProfilesModule {}
