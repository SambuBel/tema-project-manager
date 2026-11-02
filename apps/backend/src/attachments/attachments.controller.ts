/// <reference types="multer" />
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { AttachmentsService } from './attachments.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  // Adjuntos de tareas

  @Post('tasks/:taskId/attachments')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  upload(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attachments.upload(taskId, file, user);
  }

  @Get('tasks/:taskId/attachments')
  list(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attachments.list(taskId, user);
  }

  //  Comprobantes de costos

  @Post('projects/:projectId/costs/:costId/attachment')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  uploadCostAttachment(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('costId', ParseUUIDPipe) costId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attachments.uploadCostAttachment(projectId, costId, file, user);
  }

  @Get('projects/:projectId/cost-attachments')
  listCostAttachments(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attachments.listProjectCostAttachments(projectId, user);
  }

  // Descarga y eliminación

  @Get('attachments/:id/download')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const { filePath, fileName, mimeType } = await this.attachments.download(id, user);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
    res.sendFile(filePath);
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attachments.remove(id, user);
  }
}