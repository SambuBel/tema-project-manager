import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProjectEntity } from './project.entity';

@Entity('project_slug_histories')
export class ProjectSlugHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_project_slug_histories_project_id')
  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @Index('uq_project_slug_histories_slug', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  slug!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: ProjectEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
