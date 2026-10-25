import { Controller, Get, UseGuards } from '@nestjs/common';
import type { CostCategory } from '@tema/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CostCategoriesService } from './cost-categories.service';

@UseGuards(JwtAuthGuard)
@Controller('cost-categories')
export class CostCategoriesController {
  constructor(private readonly categories: CostCategoriesService) {}

  /** Rubros activos para armar presupuestos. ADMIN, PROGRAM_MANAGER y PROJECT_LEADER; el resto recibe 403. */
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<CostCategory[]> {
    return this.categories.listActive(user);
  }
}
