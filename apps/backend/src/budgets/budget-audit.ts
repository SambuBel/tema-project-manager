import { BudgetEntity } from '../database/entities/budget.entity';
import { BudgetItemView } from './dto/budget-snapshot';

/**
 * Snapshot para audit_logs (una sola fila por operación). Importes como string; el nombre del rubro va desnormalizado
 * para preservar la interpretación histórica aunque el catálogo cambie. Las auditorías anteriores a PRES-04 no tienen `items`.
 */
export function auditSnapshot(budget: BudgetEntity, items: BudgetItemView[]) {
  return {
    budgetId: budget.id,
    projectId: budget.projectId,
    version: budget.version,
    totalAmount: budget.totalAmount,
    currency: budget.currency,
    approvalDate: budget.approvalDate,
    items: items.map((item) => ({ costCategoryId: item.costCategoryId, categoryName: item.categoryName, amount: item.amount })),
  };
}
