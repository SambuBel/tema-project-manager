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
import { UserEntity } from './user.entity';
import { TaskPriority, TaskStatus } from '../enums';

/**
 * Representa tareas y subtareas (jerarquia via parent_task_id, sin tabla separada).
 * Regla de negocio "el responsable debe pertenecer al proyecto" NO esta garantizada por
 * FK simple (requeriria validar contra project_members) -> se valida en el backend.
 */
@Entity('tasks')
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_tasks_project_id')
  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Index('ix_tasks_parent_task_id')
  @Column({ name: 'parent_task_id', type: 'uuid', nullable: true })
  parentTaskId!: string | null;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_task_id' })
  parentTask!: TaskEntity | null;

  @Column({ name: 'title', type: 'varchar', length: 300 })
  title!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Index('ix_tasks_responsible_user_id')
  @Column({ name: 'responsible_user_id', type: 'uuid', nullable: true })
  responsibleUserId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'responsible_user_id' })
  responsibleUser!: UserEntity | null;

  @Index('ix_tasks_status')
  @Column({ name: 'status', type: 'enum', enum: TaskStatus, enumName: 'task_status_enum', default: TaskStatus.PENDING })
  status!: TaskStatus;

  @Column({ name: 'priority', type: 'enum', enum: TaskPriority, enumName: 'task_priority_enum', default: TaskPriority.MEDIUM })
  priority!: TaskPriority;

  @Column({ name: 'planned_start_date', type: 'date', nullable: true })
  plannedStartDate!: string | null;

  @Index('ix_tasks_due_date')
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ name: 'estimated_cost', type: 'numeric', precision: 14, scale: 2, nullable: true })
  estimatedCost!: string | null;

  @Column({ name: 'actual_cost', type: 'numeric', precision: 14, scale: 2, nullable: true })
  actualCost!: string | null;

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
