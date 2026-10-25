import {
  Check,
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
import { TaskEntity } from '../../tasks/task.entity';
import { CostCategoryEntity } from './cost-category.entity';
import { UserEntity } from './user.entity';

/**
 * Costo incurrido (RF-CT-03). Los importes no dependen del frontend: siempre NUMERIC, calculados/validados en backend.
 *  - Su moneda es SIEMPRE la del proyecto (`projects.economic_currency`): una sola moneda por proyecto, sin conversión ni FX.
 *  - NO referencia a `budgets`: es un hecho del proyecto independiente de las versiones del presupuesto. Contra qué versión
 *    se validó queda en el snapshot de auditoría (`budgetVersion`).
 *  - `description` es obligatoria (RF-CT-03): NOT NULL y no vacía en la base.
 *  - `revision` es el token de concurrencia optimista (RNF-20): arranca en 1 y cada edición suma 1 bajo el lock de la fila
 *    (el servicio la incrementa EXPLÍCITAMENTE; no es @VersionColumn). `updated_at` es solo metadato temporal.
 *  - Baja lógica con `deleted_at` (la baja la implementa COST-02): toda consulta debe excluir los eliminados.
 */
@Entity('costs')
@Check('ck_costs_amount_non_negative', '"amount" >= 0')
@Check('ck_costs_currency_iso_format', `"currency" ~ '^[A-Z]{3}$'`)
@Check('ck_costs_description_not_blank', 'length(btrim("description")) > 0')
@Check('ck_costs_revision_positive', '"revision" >= 1')
export class CostEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_costs_project_id')
  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id', foreignKeyConstraintName: 'fk_costs_project' })
  project!: ProjectEntity;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;

  @ManyToOne(() => TaskEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'task_id', foreignKeyConstraintName: 'fk_costs_task' })
  task!: TaskEntity | null;

  @Column({ name: 'cost_category_id', type: 'uuid' })
  costCategoryId!: string;

  @ManyToOne(() => CostCategoryEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cost_category_id', foreignKeyConstraintName: 'fk_costs_category' })
  costCategory!: CostCategoryEntity;

  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'cost_date', type: 'date' })
  costDate!: string;

  @Column({ name: 'description', type: 'text' })
  description!: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'fk_costs_created_by' })
  creator!: UserEntity;

  @Column({ name: 'revision', type: 'integer', default: 1 })
  revision!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
