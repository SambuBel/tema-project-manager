import { Body, Controller, Delete, HttpCode, HttpStatus, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { DependenciesService } from './dependencies.service';
import { CreateDependencyDto } from './dto/create-dependency.dto';
import { UpdateDependencyDto } from './dto/update-dependency.dto';
import { CascadePreviewDto } from './dto/cascade-preview.dto';

@UseGuards(JwtAuthGuard)
@Controller('projects')
export class DependenciesController {
  constructor(private readonly dependencies: DependenciesService) {}

  @Post(':projectId/dependencies')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateDependencyDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.dependencies.create(projectId, dto, user);
  }

  @Patch(':projectId/dependencies/:dependencyId')
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('dependencyId', ParseUUIDPipe) dependencyId: string,
    @Body() dto: UpdateDependencyDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.dependencies.update(projectId, dependencyId, dto, user);
  }

  @Delete(':projectId/dependencies/:dependencyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('dependencyId', ParseUUIDPipe) dependencyId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.dependencies.remove(projectId, dependencyId, user);
  }

    @Post(':projectId/dependencies/cascade-preview')
  previewCascade(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CascadePreviewDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.dependencies.previewCascade(projectId, dto, user);
  }

  @Post(':projectId/dependencies/cascade-apply')
  applyCascade(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CascadePreviewDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.dependencies.applyCascade(projectId, dto, user);
  }
}