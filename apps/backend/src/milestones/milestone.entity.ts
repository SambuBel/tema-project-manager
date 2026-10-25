import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectEntity } from '../projects/project.entity';
import { UserEntity } from '../database/entities/user.entity';
import { TaskEntity } from '../tasks/task.entity';

/**
 * Entidad Milestone (Hito) para KAN-242..246.
 *
 * Decisiones clave de diseño:
 * - D2: Relación 1:N con tareas (cada tarea pertenece a lo sumo a un Milestone vía tasks.milestone_id).
 * - D4: Progreso derivado automáticamente de tareas asociadas; la finalización se confirma
 *       manualmente con `completedAt` y `completedById`. No se persiste porcentaje redundante.
 * - D5: Nombres únicos por proyecto (case-insensitive) mediante índice único parcial (deleted_at IS NULL).
 * - D10: Eliminación lógica mediante `deleted_at` (@DeleteDateColumn) para conservar trazabilidad histórica.
 */
@Entity('milestones')
@Index('ix_milestones_project_id', ['projectId'])
@Index('ix_milestones_project_due_date', ['projectId', 'dueDate'])
@Index('uq_milestones_project_name_active', ['projectId', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
@Check('ck_milestones_name_not_empty', `btrim("name") <> ''`)
export class MilestoneEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id', foreignKeyConstraintName: 'fk_milestones_project' })
  project!: ProjectEntity;

  @Column({ name: 'name', type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  /**
   * Finalización manual del Milestone (D4):
   * Almacena el timestamp exacto en que fue marcado como completado.
   */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  /**
   * Usuario que confirmó manualmente la finalización del Milestone (D4).
   */
  @Column({ name: 'completed_by', type: 'uuid', nullable: true })
  completedById!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'completed_by', foreignKeyConstraintName: 'fk_milestones_completed_by' })
  completedBy!: UserEntity | null;

  /**
   * Usuario creador del Milestone.
   */
  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'fk_milestones_created_by' })
  creator!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /**
   * Baja lógica (D10): TypeORM soft-delete para conservar trazabilidad histórica.
   */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  /**
   * Tareas asociadas al Milestone (relación 1:N).
   */
  @OneToMany(() => TaskEntity, (task) => task.milestone)
  tasks?: TaskEntity[];

  // Propiedades calculadas en runtime (no columnas en la BD, evitando desincronización):
  progress?: number;
  taskCount?: number;
  completedTaskCount?: number;
}
