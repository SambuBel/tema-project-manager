import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CostCategoryEntity } from '../database/entities/cost-category.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CostCategoriesController } from './cost-categories.controller';
import { CostCategoriesService } from './cost-categories.service';

@Module({
  imports: [TypeOrmModule.forFeature([CostCategoryEntity]), AuthModule, UsersModule],
  controllers: [CostCategoriesController],
  providers: [CostCategoriesService],
})
export class CostCategoriesModule {}
