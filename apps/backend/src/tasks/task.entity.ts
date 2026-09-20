import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectEntity } from '../projects/project.entity';
import { UserEntity } from '../database/entities/user.entity';
import { TaskPriority, TaskStatus } from '../database/enums';

@Entity('tasks')
@Index('ix_tasks_project_id', ['projectId'])
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ name: 'title', type: 'varchar', length: 200 })
  title!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Index('ix_tasks_status')
  @Column({
    name: 'status',
    type: 'enum',
    enum: TaskStatus,
    enumName: 'task_status_enum',
    default: TaskStatus.PENDING,
  })
  status!: TaskStatus;

  @Column({
    name: 'priority',
    type: 'enum',
    enum: TaskPriority,
    enumName: 'task_priority_enum',
    default: TaskPriority.MEDIUM,
  })
  priority!: TaskPriority;

  @Index('ix_tasks_assigned_to_id')
  @Column({ name: 'assigned_to_id', type: 'uuid', nullable: true })
  assignedToId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_to_id' })
  assignedTo!: UserEntity | null;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
