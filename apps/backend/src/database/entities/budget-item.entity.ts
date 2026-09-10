import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BudgetEntity } from './budget.entity';
import { CostCategoryEntity } from './cost-category.entity';

@Entity('budget_items')
@Index('ux_budget_items_budget_category', ['budgetId', 'costCategoryId'], { unique: true })
export class BudgetItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'budget_id', type: 'uuid' })
  budgetId!: string;

  @ManyToOne(() => BudgetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'budget_id' })
  budget!: BudgetEntity;

  @Column({ name: 'cost_category_id', type: 'uuid' })
  costCategoryId!: string;

  @ManyToOne(() => CostCategoryEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cost_category_id' })
  costCategory!: CostCategoryEntity;

  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
