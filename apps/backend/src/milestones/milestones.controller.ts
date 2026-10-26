import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { MilestonesService } from './milestones.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { ListMilestonesQueryDto } from './dto/list-milestones-query.dto';
import { MilestoneDetailDto, MilestoneSummaryDto } from './dto/milestone-response.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  /**
   * Crea un nuevo Milestone dentro de un proyecto (KAN-243).
   * Solo accesible por ADMIN, PROGRAM_MANAGER o el líder real del proyecto.
   */
  @Post('projects/:projectId/milestones')
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentUser() user: RequestUser,
  ): Promise<MilestoneSummaryDto> {
    return this.milestonesService.create(projectId, dto, user);
  }

  /**
   * Lista los Milestones activos de un proyecto con sus métricas calculadas (KAN-243).
   * Accesible por miembros autorizados del proyecto (ADMIN, PM, líder, colaboradores y observadores).
   */
  @Get('projects/:projectId/milestones')
  async findAllByProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListMilestonesQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<MilestoneSummaryDto[]> {
    return this.milestonesService.findAllByProject(projectId, query, user);
  }

  /**
   * Consulta el detalle de un Milestone por ID con sus tareas asociadas (KAN-243).
   * Accesible por miembros autorizados del proyecto al que pertenece el hito.
   */
  @Get('milestones/:id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<MilestoneDetailDto> {
    return this.milestonesService.findOne(id, user);
  }

  /**
   * Actualiza parcialmente un Milestone existente (KAN-244).
   * Solo accesible por ADMIN, PROGRAM_MANAGER o el líder real del proyecto.
   */
  @Patch('milestones/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentUser() user: RequestUser,
  ): Promise<MilestoneSummaryDto> {
    return this.milestonesService.update(id, dto, user);
  }

  /**
   * Elimina lógicamente un Milestone desasociando sus tareas vinculadas (KAN-244).
   * Solo accesible por ADMIN, PROGRAM_MANAGER o el líder real del proyecto.
   */
  @Delete('milestones/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.milestonesService.remove(id, user);
  }

  /**
   * Confirma manualmente la finalización de un Milestone sin modificar sus tareas (KAN-244 / KAN-250).
   * Solo accesible por ADMIN, PROGRAM_MANAGER o el líder real del proyecto.
   */
  @Patch('milestones/:id/complete')
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<MilestoneSummaryDto> {
    return this.milestonesService.complete(id, user);
  }

  /**
   * Finalización conjunta de un Milestone junto con sus tareas asociadas pendientes (KAN-250).
   * Criterio funcional provisional: completa en una única transacción las subtareas y tareas principales
   * pendientes asociadas al hito y luego marca el hito como completado.
   * Solo accesible por ADMIN, PROGRAM_MANAGER o el líder real del proyecto.
   */
  @Patch('milestones/:id/complete-with-tasks')
  async completeWithTasks(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<MilestoneSummaryDto> {
    return this.milestonesService.completeWithTasks(id, user);
  }

  /**
   * Reabre un Milestone previamente marcado como completado (KAN-244 - Fase 4).
   * Solo accesible por ADMIN, PROGRAM_MANAGER o el líder real del proyecto.
   */
  @Patch('milestones/:id/reopen')
  async reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<MilestoneSummaryDto> {
    return this.milestonesService.reopen(id, user);
  }

  /**
   * Asocia una tarea a un Milestone (KAN-245).
   * Solo accesible por ADMIN, PROGRAM_MANAGER o el líder real del proyecto.
   */
  @Put('milestones/:id/tasks/:taskId')
  async associateTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<MilestoneSummaryDto> {
    return this.milestonesService.associateTask(id, taskId, user);
  }

  /**
   * Desasocia una tarea de un Milestone (KAN-245).
   * Solo accesible por ADMIN, PROGRAM_MANAGER o el líder real del proyecto.
   */
  @Delete('milestones/:id/tasks/:taskId')
  async disassociateTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<MilestoneSummaryDto> {
    return this.milestonesService.disassociateTask(id, taskId, user);
  }
}
