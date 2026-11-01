import { AttachmentEntity } from '../../database/entities/attachment.entity';

export class AttachmentResponseDto {
  id!: string;
  costId?: string | null;
  fileName!: string;
  mimeType!: string;
  sizeBytes!: number;
  uploadedBy!: string;
  uploaderName!: string;
  createdAt!: Date;
}

export function toAttachmentResponse(entity: AttachmentEntity): AttachmentResponseDto {
  const dto: AttachmentResponseDto = {
    id: entity.id,
    fileName: entity.fileName,
    mimeType: entity.mimeType,
    sizeBytes: Number(entity.sizeBytes),
    uploadedBy: entity.uploadedBy,
    uploaderName: entity.uploader?.name ?? '',
    createdAt: entity.createdAt,
  };
  if (entity.costId) {
    dto.costId = entity.costId;
  }
  return dto;
}