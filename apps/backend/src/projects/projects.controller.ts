import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsDto } from './list-projects.dto';
import { UpdateProjectStatusDto } from './update-project-status.dto';

import { AddProjectMemberDtoImpl, UpdateProjectMemberRoleDtoImpl } from './project-member.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

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

  @Post(':id/members')
  addMember(@Param('id') id: string, @Body() dto: AddProjectMemberDtoImpl) {
    return this.projects.addMember(id, dto);
  }

  @Patch(':id/members/:memberId/role')
  updateMemberRole(@Param('id') id: string, @Param('memberId') memberId: string, @Body() dto: UpdateProjectMemberRoleDtoImpl) {
    return this.projects.updateMemberRole(id, memberId, dto);
  }

  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() dto: UpdateProjectStatusDto) {
    return this.projects.changeStatus(id, dto);
  }

  @Patch(':id/archive')
  archive(@Param('id') id: string) {
    return this.projects.archive(id);
  }

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.projects.remove(id);
  }
}
