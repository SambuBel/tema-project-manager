import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ResourceProfilesService } from './resource-profiles.service';
import { CreateResourceProfileDto } from './dto/create-resource-profile.dto';
import { UpdateResourceProfileDto } from './dto/update-resource-profile.dto';
import { ListResourceProfilesQueryDto } from './dto/list-resource-profiles-query.dto';
import { ResourceProfileResponseDto } from './dto/resource-profile-response.dto';

/** La autorización (canViewResourceProfiles / canManageResourceProfiles) la resuelve ResourceProfilesService. No hay DELETE ni detalle. */
@UseGuards(JwtAuthGuard)
@Controller('resource-profiles')
export class ResourceProfilesController {
  constructor(private readonly profiles: ResourceProfilesService) {}

  /** Perfiles activos (o todos con `?includeInactive=true`). ADMIN, PROGRAM_MANAGER y PROJECT_LEADER; el resto recibe 403. */
  @Get()
  list(@Query() query: ListResourceProfilesQueryDto, @CurrentUser() user: RequestUser): Promise<ResourceProfileResponseDto[]> {
    return this.profiles.list(query, user);
  }

  /** Alta de un perfil. Solo ADMIN (provisional, pendiente de TEMA). */
  @Post()
  create(@Body() dto: CreateResourceProfileDto, @CurrentUser() user: RequestUser): Promise<ResourceProfileResponseDto> {
    return this.profiles.create(dto, user);
  }

  /** Edición parcial con `expectedRevision` obligatorio, incluido activar o desactivar. Solo ADMIN (provisional). */
  @Patch(':profileId')
  update(
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: UpdateResourceProfileDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ResourceProfileResponseDto> {
    return this.profiles.update(profileId, dto, user);
  }
}
