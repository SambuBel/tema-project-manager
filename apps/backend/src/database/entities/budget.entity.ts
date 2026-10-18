import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProjectEntity } from '../../projects/project.entity';
import { UserEntity } from './user.entity';

/**
 * Versiones del presupuesto de un proyecto (RN-18): como máximo UNA vigente (`is_current`) por proyecto; modificar
 * el presupuesto crea una versión nueva y conserva la anterior (que queda con `is_current = false` y `superseded_at`).
 * Las versiones son inmutables: no hay updated_at/updated_by ni baja lógica, solo cambian is_current y superseded_at.
 *
 * Todo lo que garantiza la base está declarado acá con los NOMBRES REALES de la base (índice parcial, CHECK y FK):
 * si faltara alguno, `typeorm migration:generate` propondría borrarlo (justo las garantías de RN-18).
 *
 * Importes: `numeric(14,2)` en la base y STRING en TypeScript (RNF-19: jamás float/number). No pasar `totalAmount`
 * por Number/parseFloat; validar el formato como texto y operar con una librería decimal o en SQL.
 *
 * Moneda: 3 letras mayúsculas (formato ISO 4217). El formato lo exige la base; qué monedas se aceptan se valida en la
 * API (todavía sin catálogo fijo).
 */
@Entity('budgets')
@Index('ux_budgets_project_version', ['projectId', 'version'], { unique: true })
@Index('ux_budgets_one_current_per_project', ['projectId'], { unique: true, where: '"is_current" = true' })
@Check('ck_budgets_total_amount_non_negative', '"total_amount" >= 0')
@Check('ck_budgets_version_positive', '"version" > 0')
@Check('ck_budgets_currency_iso_format', `"currency" ~ '^[A-Z]{3}$'`)
@Check('ck_budgets_current_not_superseded', '(NOT "is_current") OR "superseded_at" IS NULL')
export class BudgetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id', foreignKeyConstraintName: 'fk_budgets_project' })
  project!: ProjectEntity;

  @Column({ name: 'total_amount', type: 'numeric', precision: 14, scale: 2 })
  totalAmount!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'version', type: 'integer' })
  version!: number;

  /** Fecha (sin hora) de aprobación: YYYY-MM-DD. Obligatoria: no hay borradores en el MVP. */
  @Column({ name: 'approval_date', type: 'date' })
  approvalDate!: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'fk_budgets_created_by' })
  creator!: UserEntity;

  @Column({ name: 'is_current', type: 'boolean', default: false })
  isCurrent!: boolean;

  /** Cuándo dejó de ser vigente. NULL mientras `is_current` (lo exige un CHECK). */
  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
