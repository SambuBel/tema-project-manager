import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubtasksService } from './subtasks.service';
import { CreateSubtaskDto } from './dto/create-subtask.dto';
import { UpdateSubtaskDto } from './dto/update-subtask.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';

@Controller('tasks/:taskId/subtasks')
@UseGuards(JwtAuthGuard)
export class SubtasksController {
  constructor(private readonly subtasksService: SubtasksService) {}

  @Get()
  findAll(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.subtasksService.findByTask(taskId);
  }

  @Post()
  create(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateSubtaskDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.subtasksService.create(taskId, dto, user.id);
  }

  @Patch(':subtaskId')
  update(
    @Param('subtaskId', ParseUUIDPipe) subtaskId: string,
    @Body() dto: UpdateSubtaskDto,
  ) {
    return this.subtasksService.update(subtaskId, dto);
  }

  @Delete(':subtaskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('subtaskId', ParseUUIDPipe) subtaskId: string) {
    return this.subtasksService.remove(subtaskId);
  }
}