import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Delete, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { PermissionsService } from '../auth/permissions.service';
import { RoleName } from '../database/enums';
import { UsersService } from './users.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { AssignRoleDto } from './dto/assign-role.dto';

/**
 * Administración de usuarios y roles globales. Autorización en dos capas,
 * igual que el resto del repo:
 *  - GET: @Roles a nivel de clase/endpoint (RBAC global simple, ADMIN/PROGRAM_MANAGER).
 *  - status/roles: la decisión necesita contexto (¿quién es el actor Y quién es
 *    el target Y qué rol se pide?), así que NO hay @Roles acá — se resuelve en
 *    PermissionsService (canManageUserStatus/canAssignGlobalRole/canRemoveGlobalRole),
 *    igual que canEditTask necesita la tarea concreta y no alcanza con el rol solo.
 */
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async findAll(@Query() query: ListUsersQueryDto, @CurrentUser() user: RequestUser) {
    if (!this.permissions.canViewUsers(user)) {
      throw new ForbiddenException('No tenés permiso para ver el listado de usuarios.');
    }
    return this.usersService.findAllWithRoles(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    if (!this.permissions.canViewUsers(user)) {
      throw new ForbiddenException('No tenés permiso para ver este usuario.');
    }
    return this.usersService.findOneWithRoles(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto, @CurrentUser() user: RequestUser) {
    return this.usersService.setActive(id, dto.active, user);
  }

  @Post(':id/roles')
  assignRole(@Param('id') id: string, @Body() dto: AssignRoleDto, @CurrentUser() user: RequestUser) {
    return this.usersService.assignRole(id, dto.role, user);
  }

  @Delete(':id/roles/:role')
  removeRole(@Param('id') id: string, @Param('role') role: string, @CurrentUser() user: RequestUser) {
    // Validación real del valor de `role` pasa por el catálogo en UsersService
    // (si no existe, 400) — acá solo se castea para que el tipo coincida.
    return this.usersService.removeRole(id, role as RoleName, user);
  }
}
