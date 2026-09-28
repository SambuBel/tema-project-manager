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

/**
 * Entidad canonica de la tabla `tasks` creada por la migration InitialSchema (unica
 * TaskEntity del proyecto: comment/attachment/cost/notification/task-dependency/task-tag
 * la referencian desde aca). Los nombres de propiedad (assignedToId, startDate) son los
 * de la API; las columnas reales son responsible_user_id y planned_start_date, por eso
 * van con `name` explicito. No mapea subtareas ni costos (parent_task_id, estimated_cost,
 * actual_cost, deleted_at): esas columnas existen en la tabla pero quedan fuera de alcance
 * hasta que haya un ticket que las necesite.
 *
 * `archivedAt` es distinto de `deleted_at`: archivar no borra la tarea (sigue existiendo,
 * solo se oculta), mismo criterio que ya usa ProjectEntity.archivedAt.
 */
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

  @Index('ix_tasks_responsible_user_id')
  @Column({ name: 'responsible_user_id', type: 'uuid', nullable: true })
  assignedToId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'responsible_user_id' })
  assignedTo!: UserEntity | null;

  @Column({ name: 'planned_start_date', type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  /** Quien creo la tarea (created_by NOT NULL en la base): siempre el usuario autenticado. */
  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;
}
