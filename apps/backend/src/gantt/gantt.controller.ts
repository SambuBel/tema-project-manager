import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { GanttService } from './gantt.service';
import { GanttResponseDto } from './dto/gantt-response.dto';

/** Solo lectura. La autorización contextual (canViewProject) la resuelve GanttService. */
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class GanttController {
  constructor(private readonly gantt: GanttService) {}

  @Get(':projectId/gantt')
  getGantt(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<GanttResponseDto> {
    return this.gantt.getGantt(projectId, user);
  }

  @Get(':projectId/blocked-task-ids')
  getBlockedTaskIds(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<string[]> {
    return this.gantt.getBlockedTaskIds(projectId, user);
  }
}
