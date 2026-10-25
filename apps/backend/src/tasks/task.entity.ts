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
import { MilestoneEntity } from '../milestones/milestone.entity';
import { TaskPriority, TaskStatus } from '../database/enums';

/**
 * Entidad canonica de la tabla `tasks` creada por la migration InitialSchema (unica
 * TaskEntity del proyecto: comment/attachment/cost/notification/task-dependency/task-tag
 * la referencian desde aca). Los nombres de propiedad (assignedToId, startDate) son los
 * de la API; las columnas reales son responsible_user_id y planned_start_date, por eso
 * van con `name` explicito. No mapea costos (estimated_cost, actual_cost, deleted_at):
 * esas columnas existen en la tabla pero quedan fuera de alcance hasta que haya un ticket
 * que las necesite.
 *
 * `archivedAt` es distinto de `deleted_at`: archivar no borra la tarea (sigue existiendo,
 * solo se oculta), mismo criterio que ya usa ProjectEntity.archivedAt.
 * 
 * Subtareas: entidad separada, cada subtarea tiene título, responsable y estado binario
 *
 * Milestones (KAN-242): asociación opcional a MilestoneEntity (0 o 1 Milestone por tarea, D2).
 */
@Entity('tasks')
@Index('ix_tasks_project_id', ['projectId'])
@Index('uq_tasks_project_slug', ['projectId', 'slug'], { unique: true })
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ name: 'parent_task_id', type: 'uuid', nullable: true})
  parentTaskId!: string | null;

  @ManyToOne(() => TaskEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_task_id' })
  parentTask!: TaskEntity | null;

  @Index('ix_tasks_milestone_id')
  @Column({ name: 'milestone_id', type: 'uuid', nullable: true })
  milestoneId!: string | null;

  @ManyToOne(() => MilestoneEntity, (milestone) => milestone.tasks, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'milestone_id', foreignKeyConstraintName: 'fk_tasks_milestone' })
  milestone!: MilestoneEntity | null;

  @Column({ name: 'title', type: 'varchar', length: 200 })
  title!: string;

  @Column({ name: 'slug', type: 'varchar', length: 255 })
  slug!: string;

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

  /** Cantidad total de subtareas activas (calculada de forma agregada al listar). */
  subtaskCount?: number;

  /** Cantidad de subtareas activas completadas (calculada de forma agregada al listar). */
  completedSubtaskCount?: number;
}
