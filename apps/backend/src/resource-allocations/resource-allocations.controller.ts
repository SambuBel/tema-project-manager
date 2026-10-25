import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import type { MemberResourceAllocation, MemberResourceAllocationHistoryEntry, ProjectResourceAllocationSummary } from '@tema/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ResourceAllocationsService } from './resource-allocations.service';
import { UpdateMemberResourceAllocationDto } from './dto/update-member-resource-allocation.dto';

/**
 * Información ECONÓMICA del equipo (RN-25): separada de GET /projects/:id/members (organizativo, lo ve todo el equipo).
 * `:id` acepta UUID o slug, como los demás endpoints de equipo. La autorización la resuelve el servicio.
 */
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ResourceAllocationsController {
  constructor(private readonly allocations: ResourceAllocationsService) {}

  /** Asignación vigente de cada miembro activo y totales por moneda. ADMIN, PROGRAM_MANAGER y líder real; el resto recibe 403. */
  @Get(':id/resource-allocation')
  getCurrent(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<ProjectResourceAllocationSummary> {
    return this.allocations.getCurrent(id, user);
  }

  /** Historial completo (revision DESC) de un miembro, aunque esté dado de baja. Mismos permisos que la lectura vigente. */
  @Get(':id/members/:memberId/resource-allocation/history')
  getHistory(
    @Param('id') id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<MemberResourceAllocationHistoryEntry[]> {
    return this.allocations.getHistory(id, memberId, user);
  }

  /** Asigna o cambia el perfil y/o las horas (revisión nueva). ADMIN, PROGRAM_MANAGER y líder REAL; el resto recibe 403. */
  @Patch(':id/members/:memberId/resource-allocation')
  update(
    @Param('id') id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberResourceAllocationDto,
    @CurrentUser() user: RequestUser,
  ): Promise<MemberResourceAllocation> {
    return this.allocations.update(id, memberId, dto, user);
  }
}
