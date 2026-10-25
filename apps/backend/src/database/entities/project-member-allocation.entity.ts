import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AuditOrigin } from '../enums';
import { BudgetEntity } from './budget.entity';
import { ProjectMemberEntity } from './project-member.entity';
import { ResourceProfileEntity } from './resource-profile.entity';
import { UserEntity } from './user.entity';

/**
 * Asignación económica de recursos de un miembro (RF-CT-06 / RF-CT-07), VERSIONADA e INMUTABLE. Es la ÚNICA fuente de verdad
 * de la información económica del miembro (`project_members` es solo organizativo) y a la vez su historial funcional:
 *  - cada cambio crea una revisión nueva (MAX(revision) + 1, bajo el lock del miembro); solo una es vigente (`is_current`);
 *  - las revisiones históricas no se modifican (un trigger rechaza todo UPDATE salvo pasar la vigente a histórica);
 *  - perfil, tarifa y moneda son un SNAPSHOT: cambiar después el catálogo (`resource_profiles`) no toca ninguna asignación;
 *  - el costo estimado se GUARDA (horas × tarifa del snapshot, redondeo HALF-UP a 2 decimales por asignación) y la base exige
 *    que sea coherente con sus insumos; los totales suman esos importes ya redondeados;
 *  - `budget_id` = presupuesto vigente al crear la revisión (null = no había); la versión se obtiene por join con `budgets`;
 *  - `changed_by`, `created_at` y `origin` cumplen la trazabilidad (RNF-18) sin duplicar nada en `audit_logs`;
 *  - RN-25: es información económica; jamás va a `project_activities` ni a respuestas organizativas.
 * No lleva project_id (se obtiene por el miembro). Se borra en cascada solo si se borra físicamente el miembro/proyecto.
 */
@Entity('project_member_allocations')
@Index('ux_pm_allocations_member_revision', ['projectMemberId', 'revision'], { unique: true })
@Index('ux_pm_allocations_one_current', ['projectMemberId'], { unique: true, where: '"is_current" = true' })
@Check('ck_pm_allocations_revision_positive', '"revision" >= 1')
@Check('ck_pm_allocations_current_not_superseded', '(NOT "is_current") OR "superseded_at" IS NULL')
@Check(
  'ck_pm_allocations_profile_snapshot_consistent',
  '("resource_profile_id" IS NULL AND "profile_name_snapshot" IS NULL AND "hourly_cost_snapshot" IS NULL AND "currency_snapshot" IS NULL) OR ("resource_profile_id" IS NOT NULL AND "profile_name_snapshot" IS NOT NULL AND "hourly_cost_snapshot" IS NOT NULL AND "currency_snapshot" IS NOT NULL)',
)
@Check('ck_pm_allocations_currency_iso_format', `"currency_snapshot" ~ '^[A-Z]{3}$'`)
@Check('ck_pm_allocations_hourly_cost_non_negative', '"hourly_cost_snapshot" >= 0')
@Check('ck_pm_allocations_estimated_hours_non_negative', '"estimated_hours" >= 0')
@Check('ck_pm_allocations_estimated_cost_non_negative', '"estimated_cost_snapshot" >= 0')
@Check(
  'ck_pm_allocations_cost_presence',
  '("estimated_cost_snapshot" IS NULL) = ("estimated_hours" IS NULL OR "hourly_cost_snapshot" IS NULL)',
)
@Check('ck_pm_allocations_cost_matches_inputs', '"estimated_cost_snapshot" = round("estimated_hours" * "hourly_cost_snapshot", 2)')
export class ProjectMemberAllocationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_member_id', type: 'uuid' })
  projectMemberId!: string;

  @ManyToOne(() => ProjectMemberEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_member_id', foreignKeyConstraintName: 'fk_pm_allocations_member' })
  projectMember!: ProjectMemberEntity;

  @Column({ name: 'revision', type: 'integer' })
  revision!: number;

  @Column({ name: 'is_current', type: 'boolean' })
  isCurrent!: boolean;

  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;

  @Column({ name: 'resource_profile_id', type: 'uuid', nullable: true })
  resourceProfileId!: string | null;

  @ManyToOne(() => ResourceProfileEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'resource_profile_id', foreignKeyConstraintName: 'fk_pm_allocations_profile' })
  resourceProfile!: ResourceProfileEntity | null;

  @Column({ name: 'profile_name_snapshot', type: 'varchar', length: 150, nullable: true })
  profileNameSnapshot!: string | null;

  @Column({ name: 'hourly_cost_snapshot', type: 'numeric', precision: 12, scale: 2, nullable: true })
  hourlyCostSnapshot!: string | null;

  @Column({ name: 'currency_snapshot', type: 'varchar', length: 3, nullable: true })
  currencySnapshot!: string | null;

  @Column({ name: 'estimated_hours', type: 'numeric', precision: 8, scale: 2, nullable: true })
  estimatedHours!: string | null;

  /** numeric(18,2): el producto máximo posible (hasta ~10^16) nunca desborda. */
  @Column({ name: 'estimated_cost_snapshot', type: 'numeric', precision: 18, scale: 2, nullable: true })
  estimatedCostSnapshot!: string | null;

  @Column({ name: 'budget_id', type: 'uuid', nullable: true })
  budgetId!: string | null;

  @ManyToOne(() => BudgetEntity, { nullable: true })
  @JoinColumn({ name: 'budget_id', foreignKeyConstraintName: 'fk_pm_allocations_budget' })
  budget!: BudgetEntity | null;

  @Column({ name: 'changed_by', type: 'uuid' })
  changedBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'changed_by', foreignKeyConstraintName: 'fk_pm_allocations_changed_by' })
  changer!: UserEntity;

  /** Mismo tipo/enum que audit_logs y project_activities. Hoy siempre UI; una futura operación de IA registra AI sin cambiar el modelo. */
  @Column({ name: 'origin', type: 'enum', enum: AuditOrigin, enumName: 'audit_origin_enum', default: AuditOrigin.UI })
  origin!: AuditOrigin;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
