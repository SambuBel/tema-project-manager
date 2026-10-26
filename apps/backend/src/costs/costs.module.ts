import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from '../projects/project.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CostsController } from './costs.controller';
import { CostsService } from './costs.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity]), AuthModule, UsersModule],
  controllers: [CostsController],
  providers: [CostsService],
})
export class CostsModule {}
