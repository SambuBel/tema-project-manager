import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { FilterTasksDto } from './dto/filter-tasks.dto';
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
  findAll(@Query() filters: FilterTasksDto, @CurrentUser() user: RequestUser) {
    return this.tasksService.findAllByProject(filters, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.tasksService.findOne(id, user);
  }

  @Get(':id/subtasks')
  findSubtasks(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.tasksService.findSubtasks(id, user);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto, @CurrentUser() user: RequestUser) {
    return this.tasksService.update(id, dto, user);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tasksService.updateStatus(id, dto, user);
  }

  @Patch(':id/archive')
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.tasksService.archive(id, user);
  }
}
