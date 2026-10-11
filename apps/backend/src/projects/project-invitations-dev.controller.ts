import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { NonProductionGuard } from './non-production.guard';
import { ProjectsService } from './projects.service';

/**
 * Helper de DESARROLLO: simula que el invitado aceptó, porque todavía no existe el envío de
 * mail ni el flujo real de aceptación. Deshabilitado en producción (NonProductionGuard) y,
 * fuera de producción, exige administrar el equipo del proyecto de la URL (ver el service).
 */
@UseGuards(NonProductionGuard, JwtAuthGuard)
@Controller('projects')
export class ProjectInvitationsDevController {
  constructor(private readonly projects: ProjectsService) {}

  @Post(':id/invitations/:invitationId/test-accept')
  testAcceptInvitation(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.projects.testAcceptInvitation(id, invitationId, user);
  }
}
