import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ExportService, ExportTaskFilters } from './export.service';

/**
 * Los endpoints devuelven archivos CSV con Content-Disposition: attachment.
 */
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  /** exportar vista de portafolio (todos los proyectos del usuario) a CSV. */
  @Get('export/portfolio')
  async exportPortfolio(
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const csv = await this.exportService.exportPortfolioCsv(user);
    const filename = `portafolio_${new Date().toISOString().slice(0, 10)}.csv`;
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(csv);
  }

  /** exportar listado de tareas a CSV, respetando filtros de pantalla. */
  @Get(':projectId/export/tasks')
  async exportTasks(
    @Param('projectId') projectId: string,
    @Query() filters: ExportTaskFilters,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const csv = await this.exportService.exportTasksCsv(projectId, filters, user);
    const filename = `tareas_${new Date().toISOString().slice(0, 10)}.csv`;
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(csv);
  }

  /** exportar historial de estados del proyecto a CSV. */
  @Get(':projectId/export/status-history')
  async exportStatusHistory(
    @Param('projectId') projectId: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const csv = await this.exportService.exportStatusHistoryCsv(projectId, user);
    const filename = `historial-estados_${new Date().toISOString().slice(0, 10)}.csv`;
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(csv);
  }

  @Get(':projectId/export/economic-report')
  async exportEconomicReport(
    @Param('projectId') projectId: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const csv = await this.exportService.exportEconomicReportCsv(projectId, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte-economico.csv"');
    res.send(csv);
  }
}