import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TaskEntity } from './task.entity';
import { CostEntity } from './cost.entity';
import { UserEntity } from './user.entity';

/**
 * Un adjunto pertenece exactamente a una tarea O a un costo (no ambos, no ninguno).
 * Garantizado por CHECK constraint `ck_attachments_exactly_one_owner` en la migration.
 */
@Entity('attachments')
export class AttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'task_id' })
  task!: TaskEntity | null;

  @Column({ name: 'cost_id', type: 'uuid', nullable: true })
  costId!: string | null;

  @ManyToOne(() => CostEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'cost_id' })
  cost!: CostEntity | null;

  @Column({ name: 'file_name', type: 'varchar', length: 300 })
  fileName!: string;

  @Column({ name: 'storage_path', type: 'varchar', length: 1000 })
  storagePath!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 150 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploaded_by' })
  uploader!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
