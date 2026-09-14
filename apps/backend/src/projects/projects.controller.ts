import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsDto } from './list-projects.dto';
import { UpdateProjectStatusDto } from './update-project-status.dto';

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

  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() dto: UpdateProjectStatusDto) {
    return this.projects.changeStatus(id, dto);
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
