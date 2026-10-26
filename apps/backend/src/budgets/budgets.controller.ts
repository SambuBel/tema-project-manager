import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { CreateBudgetVersionDto } from './dto/create-budget-version.dto';
import { BudgetHistoryEntryDto, BudgetResponseDto } from './dto/budget-response.dto';

/** La autorización contextual (canDefineBudget / canViewEconomicData) la resuelve BudgetsService. */
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  /** Presupuesto inicial del proyecto (versión 1, vigente). Solo ADMIN / PROGRAM_MANAGER. */
  @Post(':projectId/budget')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateBudgetDto,
    @CurrentUser() user: RequestUser,
  ): Promise<BudgetResponseDto> {
    return this.budgets.create(projectId, dto, user);
  }

  /** Nueva versión del presupuesto (la vigente pasa a histórica). Solo ADMIN / PROGRAM_MANAGER. */
  @Post(':projectId/budget/versions')
  createVersion(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateBudgetVersionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<BudgetResponseDto> {
    return this.budgets.createVersion(projectId, dto, user);
  }

  /**
   * Historial completo (todas las versiones, version DESC, cada una con sus partidas). ADMIN, PROGRAM_MANAGER y líder real;
   * el resto recibe 403. Ruta fija `history`: no choca con `:projectId/budget`.
   */
  @Get(':projectId/budget/history')
  getHistory(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<BudgetHistoryEntryDto[]> {
    return this.budgets.getHistory(projectId, user);
  }

  /** Presupuesto vigente (is_current = true). ADMIN, PROGRAM_MANAGER y líder real; el resto recibe 403. */
  @Get(':projectId/budget')
  getCurrent(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<BudgetResponseDto> {
    return this.budgets.getCurrent(projectId, user);
  }
}
