import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProjectEntity } from '../../projects/project.entity';

/** Snapshot de avance de un proyecto en un momento dado. */
@Entity('progress_metrics')
@Index('ix_progress_metrics_project_measured_at', ['projectId', 'measuredAt'])
export class ProgressMetricEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ name: 'measured_at', type: 'timestamptz' })
  measuredAt!: Date;

  @Column({ name: 'actual_progress', type: 'numeric', precision: 5, scale: 2 })
  actualProgress!: string;

  @Column({ name: 'expected_progress', type: 'numeric', precision: 5, scale: 2, nullable: true })
  expectedProgress!: string | null;

  @Column({ name: 'deviation', type: 'numeric', precision: 5, scale: 2, nullable: true })
  deviation!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
