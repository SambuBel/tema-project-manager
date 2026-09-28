import { BadRequestException, ForbiddenException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, UseGuards, DefaultValuePipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../database/entities/user.entity';
import { ProjectsService } from './projects.service';
import { ProjectActivityService } from './project-activity.service';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsDto } from './list-projects.dto';
import { UpdateProjectStatusDto } from './update-project-status.dto';
import { UpdateProjectDtoImpl } from './update-project.dto';

import { AddProjectMemberDtoImpl, UpdateProjectMemberRoleDtoImpl } from './project-member.dto';

@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly activityService: ProjectActivityService,
  ) {}

  @Get()
  findAll(@Query() query: ListProjectsDto) {
    return this.projects.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.projects.findOne(id);
  }

  @Get(':id/members')
  getMembers(@Param('id') id: string) {
    return this.projects.getMembers(id);
  }

  @Get(':id/activity')
  async getActivity(
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @CurrentUser() user: UserEntity,
  ) {
    if (limit < 1 || limit > 100) throw new BadRequestException('El límite debe estar entre 1 y 100');
    if (offset < 0) throw new BadRequestException('El offset no puede ser negativo');

    const hasAccess = await this.projects.checkIsMemberOrLeader(id, user.id);
    if (!hasAccess) {
      throw new ForbiddenException('No tienes permisos para ver la actividad de este proyecto');
    }
    
    return this.activityService.getActivity(id, limit, offset);
  }

  @Post(':id/members')
  addMember(@Param('id') id: string, @Body() dto: AddProjectMemberDtoImpl, @CurrentUser() user: UserEntity) {
    return this.projects.addMember(id, dto, user);
  }

  @Patch(':id/members/:memberId/role')
  updateMemberRole(@Param('id') id: string, @Param('memberId') memberId: string, @Body() dto: UpdateProjectMemberRoleDtoImpl, @CurrentUser() user: UserEntity) {
    return this.projects.updateMemberRole(id, memberId, dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDtoImpl, @CurrentUser() user: UserEntity) {
    return this.projects.update(id, dto, user);
  }

  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() dto: UpdateProjectStatusDto, @CurrentUser() user: UserEntity) {
    return this.projects.changeStatus(id, dto, user);
  }

  @Patch(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.projects.archive(id, user);
  }

  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: UserEntity) {
    return this.projects.create(dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.projects.remove(id, user);
  }
}
