import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProjectEntity } from '../../projects/project.entity';
import { UserEntity } from './user.entity';
import { ProjectStatus } from '../enums';

/** Historial de cambios de estado de un proyecto (auditoria especifica, separada de audit_logs). */
@Entity('project_status_history')
export class ProjectStatusHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_project_status_history_project_id')
  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({
    name: 'previous_status',
    type: 'enum',
    enum: ProjectStatus,
    enumName: 'project_status_enum',
    nullable: true,
  })
  previousStatus!: ProjectStatus | null;

  @Column({ name: 'new_status', type: 'enum', enum: ProjectStatus, enumName: 'project_status_enum' })
  newStatus!: ProjectStatus;

  @Column({ name: 'changed_by_user_id', type: 'uuid' })
  changedByUserId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'changed_by_user_id' })
  changedByUser!: UserEntity;

  @CreateDateColumn({ name: 'changed_at', type: 'timestamptz' })
  changedAt!: Date;
}
