import { BadRequestException, Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards, Delete, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { RoleName } from '../database/enums';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsDto } from './list-projects.dto';
import { InviteProjectMemberDto } from './invite-project-member.dto';
import { UpdateProjectStatusDto } from './update-project-status.dto';
import { UpdateProjectDtoImpl } from './update-project.dto';
import { ChangeProjectLeaderDto } from './change-project-leader.dto';

import { AddProjectMemberDtoImpl, UpdateProjectMemberRoleDtoImpl } from './project-member.dto';

/**
 * JwtAuthGuard (autenticación) + RolesGuard (RBAC global) van SIEMPRE juntos acá.
 * RolesGuard no hace nada en los métodos sin @Roles(...) — ahí la autorización es
 * contextual y la resuelve ProjectsService con PermissionsService (ownership del
 * proyecto/membership), no un rol global. No hay DELETE /projects/:id: el cliente
 * solo contempla archivar, no borrar proyectos.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  findAll(@Query() query: ListProjectsDto, @CurrentUser() user: RequestUser) {
    return this.projects.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.findOne(id, user);
  }

  @Get(':id/members')
  getMembers(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.getMembers(id, user);
  }

  @Get(':id/activity')
  getActivity(
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @CurrentUser() user: RequestUser,
  ) {
    if (limit < 1 || limit > 100) throw new BadRequestException('El límite debe estar entre 1 y 100');
    if (offset < 0) throw new BadRequestException('El offset no puede ser negativo');

    // El chequeo de acceso (mismo criterio que ver el proyecto) vive en el
    // service, junto a la carga del proyecto — evita un segundo query separado.
    return this.projects.getActivity(id, limit, offset, user);
  }

  @Get(':id/invitations')
  getInvitations(@Param('id') id: string) {
    return this.projects.getPendingInvitations(id);
  }

  @Post(':id/invitations')
  inviteMember(@Param('id') id: string, @Body() dto: InviteProjectMemberDto, @CurrentUser() user: RequestUser) {
    return this.projects.inviteMember(id, dto, user);
  }

  @Post(':id/invitations/:invitationId/test-accept')
  @HttpCode(204)
  testAcceptInvitation(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.projects.testAcceptInvitation(id, invitationId, user);
  }

  @Post(':id/members')
  addMember(@Param('id') id: string, @Body() dto: AddProjectMemberDtoImpl, @CurrentUser() user: RequestUser) {
    return this.projects.addMember(id, dto, user);
  }

  @Delete(':id/members/:memberId')
  removeMember(@Param('id') id: string, @Param('memberId') memberId: string, @CurrentUser() user: RequestUser) {
    return this.projects.removeMember(id, memberId, user);
  }

  @Patch(':id/members/:memberId/role')
  updateMemberRole(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateProjectMemberRoleDtoImpl,
    @CurrentUser() user: RequestUser,
  ) {
    return this.projects.updateMemberRole(id, memberId, dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDtoImpl, @CurrentUser() user: RequestUser) {
    return this.projects.update(id, dto, user);
  }

  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() dto: UpdateProjectStatusDto, @CurrentUser() user: RequestUser) {
    return this.projects.changeStatus(id, dto, user);
  }

  @Patch(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.archive(id, user);
  }

  /** Solo ADMIN/PROGRAM_MANAGER pueden reasignar el líder de un proyecto existente. */
  @Patch(':id/leader')
  @Roles(RoleName.ADMIN, RoleName.PROGRAM_MANAGER)
  changeLeader(@Param('id') id: string, @Body() dto: ChangeProjectLeaderDto, @CurrentUser() user: RequestUser) {
    return this.projects.changeLeader(id, dto, user);
  }

  /**
   * Crear proyecto: ADMIN/PROGRAM_MANAGER/PROJECT_LEADER (rol global). El creador
   * queda como leaderId — ver nota en ProjectsService.create.
   */
  @Post()
  @Roles(RoleName.ADMIN, RoleName.PROGRAM_MANAGER, RoleName.PROJECT_LEADER)
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: RequestUser) {
    return this.projects.create(dto, user);
  }
}
