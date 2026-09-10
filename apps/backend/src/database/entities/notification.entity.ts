import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from './user.entity';
import { ProjectEntity } from '../../projects/project.entity';
import { TaskEntity } from './task.entity';
import { NotificationChannel } from '../enums';

/**
 * `type` queda como varchar libre (ej: TASK_ASSIGNED, PROJECT_STATUS_CHANGED) porque el
 * catalogo de tipos de notificacion todavia no esta cerrado; `channel` si es un enum acotado
 * para poder distinguir IN_APP/EMAIL sin implementar el envio real (fuera de alcance aca).
 */
@Entity('notifications')
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_notifications_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId!: string | null;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'task_id' })
  task!: TaskEntity | null;

  @Column({ name: 'type', type: 'varchar', length: 50 })
  type!: string;

  @Column({
    name: 'channel',
    type: 'enum',
    enum: NotificationChannel,
    enumName: 'notification_channel_enum',
    default: NotificationChannel.IN_APP,
  })
  channel!: NotificationChannel;

  @Column({ name: 'title', type: 'varchar', length: 200 })
  title!: string;

  @Column({ name: 'message', type: 'text' })
  message!: string;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
