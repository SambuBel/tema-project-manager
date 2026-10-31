import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response, Request } from 'express';
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

  @Get('export/portfolio/pdf')
  async exportPortfolioPdf(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const buffer = await this.exportService.exportPortfolioPdf(req.user as RequestUser);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="portafolio.pdf"',
    });
    res.end(buffer);
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

  @Get(':projectId/export/tasks/pdf')
  async exportTasksPdf(
    @Param('projectId') projectId: string,
    @Query() filters: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const buffer = await this.exportService.exportTasksPdf(projectId, filters, req.user as RequestUser);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="tareas.pdf"',
    });
    res.end(buffer);
  }

  @Get(':projectId/export/economic-report/pdf')
  async exportEconomicReportPdf(
    @Param('projectId') projectId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const buffer = await this.exportService.exportEconomicReportPdf(projectId, req.user as RequestUser);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="informe-economico.pdf"',
    });
    res.end(buffer);
  }
}