import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { PaginatedResponse } from '@tema/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CostsService } from './costs.service';
import { CreateCostDto } from './dto/create-cost.dto';
import { ListCostsQueryDto } from './dto/list-costs-query.dto';
import { UpdateCostDto } from './dto/update-cost.dto';
import { CostResponseDto } from './dto/cost-response.dto';

/** La autorización contextual (canManageCosts / canViewEconomicData) la resuelve CostsService. */
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class CostsController {
  constructor(private readonly costs: CostsService) {}

  /** Registra un costo. ADMIN, PROGRAM_MANAGER y líder REAL del proyecto; el resto recibe 403. */
  @Post(':projectId/costs')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateCostDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CostResponseDto> {
    return this.costs.create(projectId, dto, user);
  }

  /** Costos del proyecto, paginados. ADMIN, PROGRAM_MANAGER y líder real; el resto recibe 403. */
  @Get(':projectId/costs')
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListCostsQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PaginatedResponse<CostResponseDto>> {
    return this.costs.list(projectId, query, user);
  }

  /** Detalle de un costo. ADMIN, PROGRAM_MANAGER y líder real; el resto recibe 403. 404 COST_NOT_FOUND si no existe en el proyecto. */
  @Get(':projectId/costs/:costId')
  getOne(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('costId', ParseUUIDPipe) costId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<CostResponseDto> {
    return this.costs.getOne(projectId, costId, user);
  }

  /** Edición parcial con `expectedRevision` obligatorio. ADMIN, PROGRAM_MANAGER y líder REAL; el resto recibe 403. */
  @Patch(':projectId/costs/:costId')
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('costId', ParseUUIDPipe) costId: string,
    @Body() dto: UpdateCostDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CostResponseDto> {
    return this.costs.update(projectId, costId, dto, user);
  }
}
