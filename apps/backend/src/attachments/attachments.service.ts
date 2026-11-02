/// <reference types="multer" />
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AttachmentEntity } from '../database/entities/attachment.entity';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { CostEntity } from '../database/entities/cost.entity';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { AttachmentResponseDto, toAttachmentResponse } from './dto/attachment-response.dto';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class AttachmentsService {
  private readonly uploadsDir = path.join(process.cwd(), 'uploads');

  constructor(
    @InjectRepository(AttachmentEntity)
    private readonly attachmentRepo: Repository<AttachmentEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(CostEntity)
    private readonly costRepo: Repository<CostEntity>,
    private readonly permissions: PermissionsService,
  ) {
    // Asegurar que la carpeta uploads exista
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  // ── Adjuntos de TAREAS ──────────────────────────────────────────────

  async upload(
    taskId: string,
    file: Express.Multer.File,
    user: RequestUser,
  ): Promise<AttachmentResponseDto> {
    if (!file) {
      throw new BadRequestException('No se envió ningún archivo.');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('El archivo supera el límite de 10 MB.');
    }

    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['project'],
    });
    if (!task) throw new NotFoundException('Tarea no encontrada.');

    const project = task.project;
    const canView = await this.permissions.canViewProject(user, project);
    if (!canView) throw new ForbiddenException('No tenés acceso a este proyecto.');

    // Guardar archivo en disco
    const ext = path.extname(file.originalname);
    const storedName = `${randomUUID()}${ext}`;
    const storagePath = path.join(this.uploadsDir, storedName);
    fs.writeFileSync(storagePath, file.buffer);

    // Crear registro en DB
    const attachment = this.attachmentRepo.create({
      taskId,
      fileName: file.originalname,
      storagePath,
      mimeType: file.mimetype,
      sizeBytes: String(file.size),
      uploadedBy: user.id,
    });
    const saved = await this.attachmentRepo.save(attachment);

    // Recargar con relación uploader para el DTO
    const full = await this.attachmentRepo.findOne({
      where: { id: saved.id },
      relations: ['uploader'],
    });

    return toAttachmentResponse(full!);
  }

  async list(taskId: string, user: RequestUser): Promise<AttachmentResponseDto[]> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['project'],
    });
    if (!task) throw new NotFoundException('Tarea no encontrada.');

    const canView = await this.permissions.canViewProject(user, task.project);
    if (!canView) throw new ForbiddenException('No tenés acceso a este proyecto.');

    const attachments = await this.attachmentRepo.find({
      where: { taskId },
      relations: ['uploader'],
      order: { createdAt: 'DESC' },
    });

    return attachments.map(toAttachmentResponse);
  }

  // ── Comprobantes de COSTOS ──────────────────────────────────────────

  async uploadCostAttachment(
    projectId: string,
    costId: string,
    file: Express.Multer.File,
    user: RequestUser,
  ): Promise<AttachmentResponseDto> {
    if (!file) {
      throw new BadRequestException('No se envió ningún archivo.');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('El archivo supera el límite de 10 MB.');
    }

    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');

    if (!this.permissions.canManageCosts(user, project)) {
      throw new ForbiddenException('No tenés permisos para adjuntar comprobantes en este proyecto.');
    }

    const cost = await this.costRepo.findOne({
      where: { id: costId, projectId },
    });
    if (!cost) throw new NotFoundException('Costo no encontrado.');

    // Solo un comprobante por costo
    const existing = await this.attachmentRepo.findOne({ where: { costId } });
    if (existing) {
      throw new BadRequestException('Este costo ya tiene un comprobante. Eliminá el actual antes de subir otro.');
    }

    const ext = path.extname(file.originalname);
    const storedName = `${randomUUID()}${ext}`;
    const storagePath = path.join(this.uploadsDir, storedName);
    fs.writeFileSync(storagePath, file.buffer);

    const attachment = this.attachmentRepo.create({
      costId,
      fileName: file.originalname,
      storagePath,
      mimeType: file.mimetype,
      sizeBytes: String(file.size),
      uploadedBy: user.id,
    });
    const saved = await this.attachmentRepo.save(attachment);

    const full = await this.attachmentRepo.findOne({
      where: { id: saved.id },
      relations: ['uploader'],
    });

    return toAttachmentResponse(full!);
  }

  async listProjectCostAttachments(
    projectId: string,
    user: RequestUser,
  ): Promise<AttachmentResponseDto[]> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');

    if (!this.permissions.canManageCosts(user, project)) {
      throw new ForbiddenException('No tenés acceso a los costos de este proyecto.');
    }

    const attachments = await this.attachmentRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.uploader', 'u')
      .innerJoin('a.cost', 'c')
      .where('c.project_id = :projectId', { projectId })
      .andWhere('c.deleted_at IS NULL')
      .orderBy('a.created_at', 'DESC')
      .getMany();

    return attachments.map(toAttachmentResponse);
  }

  // ── Descarga y eliminación (tareas + costos) ────────────────────────

  async download(
    attachmentId: string,
    user: RequestUser,
  ): Promise<{ filePath: string; fileName: string; mimeType: string }> {
    const attachment = await this.attachmentRepo.findOne({
      where: { id: attachmentId },
      relations: ['task', 'task.project', 'cost', 'cost.project'],
    });
    if (!attachment) throw new NotFoundException('Adjunto no encontrado.');

    const project = attachment.task?.project ?? attachment.cost?.project;
    if (!project) throw new NotFoundException('Adjunto no encontrado.');

    if (attachment.task) {
      const canView = await this.permissions.canViewProject(user, project);
      if (!canView) throw new ForbiddenException('No tenés acceso a este proyecto.');
    } else {
      if (!this.permissions.canManageCosts(user, project)) {
        throw new ForbiddenException('No tenés acceso a los costos de este proyecto.');
      }
    }

    if (!fs.existsSync(attachment.storagePath)) {
      throw new NotFoundException('El archivo no se encuentra en el servidor.');
    }

    return {
      filePath: attachment.storagePath,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    };
  }

  async remove(attachmentId: string, user: RequestUser): Promise<void> {
    const attachment = await this.attachmentRepo.findOne({
      where: { id: attachmentId },
      relations: ['task', 'task.project', 'cost', 'cost.project'],
    });
    if (!attachment) throw new NotFoundException('Adjunto no encontrado.');

    const project = attachment.task?.project ?? attachment.cost?.project;
    if (!project) throw new NotFoundException('Adjunto no encontrado.');

    if (attachment.task) {
      const isUploader = attachment.uploadedBy === user.id;
      const isAdminOrLeader = this.permissions.canManageProject(user, project);
      if (!isUploader && !isAdminOrLeader) {
        throw new ForbiddenException('No tenés permisos para eliminar este adjunto.');
      }
    } else {
      if (!this.permissions.canManageCosts(user, project)) {
        throw new ForbiddenException('No tenés permisos para eliminar comprobantes de este proyecto.');
      }
    }

    // Eliminar archivo del disco
    if (fs.existsSync(attachment.storagePath)) {
      fs.unlinkSync(attachment.storagePath);
    }

    await this.attachmentRepo.remove(attachment);
  }
}