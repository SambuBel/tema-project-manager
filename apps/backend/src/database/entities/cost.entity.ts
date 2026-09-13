import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectEntity } from '../../projects/project.entity';
import { TaskEntity } from './task.entity';
import { CostCategoryEntity } from './cost-category.entity';
import { UserEntity } from './user.entity';

/** Los importes no dependen del frontend: siempre NUMERIC, calculados/validados en backend. */
@Entity('costs')
export class CostEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_costs_project_id')
  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;

  @ManyToOne(() => TaskEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'task_id' })
  task!: TaskEntity | null;

  @Column({ name: 'cost_category_id', type: 'uuid' })
  costCategoryId!: string;

  @ManyToOne(() => CostCategoryEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cost_category_id' })
  costCategory!: CostCategoryEntity;

  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'cost_date', type: 'date' })
  costDate!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
