import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TaskEntity } from './task.entity';
import { ProjectEntity } from '../projects/project.entity';

@Entity('task_slug_histories')
@Index('uq_task_slug_histories_project_slug', ['projectId', 'slug'], { unique: true })
export class TaskSlugHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_task_slug_histories_task_id')
  @Column({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  @Index('idx_task_slug_histories_project_id')
  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @Column({ type: 'varchar', length: 255 })
  slug!: string;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task?: TaskEntity;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: ProjectEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
