import { Body, Controller, DefaultValuePipe, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateTaskDto } from './dto/create-task.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { FilterTasksDto } from './dto/filter-tasks.dto';
import { TaskListItemDto, toTaskListItem } from './dto/task-list-item.dto';
import { TasksService } from './tasks.service';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';

/**
 * No hay DELETE /tasks/:id: "eliminar tarea" de la matriz funcional es RN-07
 * (baja lógica) — PATCH :id/archive es su única implementación. Ver el análisis
 * completo en la respuesta del paso 4 de la HU de roles/permisos.
 */
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: RequestUser) {
    return this.tasksService.create(dto, user);
  }

  @Get()
  async findAll(@Query() filters: FilterTasksDto, @CurrentUser() user: RequestUser) {
    const result = await this.tasksService.findAllByProject(filters, user);
    return { ...result, data: result.data.map(toTaskListItem) };
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.tasksService.findOne(id, user, projectId);
  }

  @Get(':id/subtasks')
  findSubtasks(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.tasksService.findSubtasks(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @CurrentUser() user: RequestUser) {
    return this.tasksService.update(id, dto, user);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tasksService.updateStatus(id, dto, user);
  }

  @Post(':id/comments')
  addComment(
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tasksService.addComment(id, dto.content, user, dto.mentions);
  }

  @Patch(':id/comments/:commentId')
  updateComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tasksService.updateComment(id, commentId, dto.content, user, dto.mentions);
  }

  @Delete(':id/comments/:commentId')
  deleteComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tasksService.deleteComment(id, commentId, user);
  }

  @Get(':id/timeline')
  getTimeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tasksService.getTimeline(id, user, page, limit);
  }

  @Patch(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.tasksService.archive(id, user);
  }
}