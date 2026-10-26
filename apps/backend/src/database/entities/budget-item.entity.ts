import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BudgetEntity } from './budget.entity';
import { CostCategoryEntity } from './cost-category.entity';

/**
 * Partida de UNA versión de presupuesto. Cada versión tiene sus PROPIAS filas (nunca se comparten ni se mueven entre
 * versiones) y son INMUTABLES: un trigger de PostgreSQL rechaza todo UPDATE. No tiene moneda propia: se expresa en la
 * moneda de `budgets.currency`. Un cambio económico = nueva versión del presupuesto con filas nuevas.
 */
@Entity('budget_items')
@Check('ck_budget_items_amount_non_negative', '"amount" >= 0')
@Index('ux_budget_items_budget_category', ['budgetId', 'costCategoryId'], { unique: true })
export class BudgetItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'budget_id', type: 'uuid' })
  budgetId!: string;

  @ManyToOne(() => BudgetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'budget_id', foreignKeyConstraintName: 'fk_budget_items_budget' })
  budget!: BudgetEntity;

  @Column({ name: 'cost_category_id', type: 'uuid' })
  costCategoryId!: string;

  @ManyToOne(() => CostCategoryEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cost_category_id', foreignKeyConstraintName: 'fk_budget_items_category' })
  costCategory!: CostCategoryEntity;

  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
