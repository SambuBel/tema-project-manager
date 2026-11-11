import { EntityManager } from 'typeorm';
import { BudgetItemEntity } from '../database/entities/budget-item.entity';
import { BudgetVersionRow } from './dto/budget-response.dto';
import { BudgetItemView, sortItems } from './dto/budget-snapshot';

/** Cada versión inserta sus PROPIAS filas (ids nuevos); jamás se reutilizan ni se mueven las de otra versión. */
export async function insertItems(manager: EntityManager, budgetId: string, items: BudgetItemView[]): Promise<void> {
  await manager.insert(
    BudgetItemEntity,
    items.map((item) => ({ budgetId, costCategoryId: item.costCategoryId, amount: item.amount })),
  );
}

/** Partidas de una versión con el nombre del rubro (activo o no), en orden estable. */
export async function loadItems(manager: EntityManager, budgetId: string): Promise<BudgetItemView[]> {
  const rows: BudgetItemView[] = await manager.query(
    `SELECT bi.cost_category_id AS "costCategoryId", cc.name AS "categoryName", bi.amount::text AS amount
       FROM budget_items bi
       JOIN cost_categories cc ON cc.id = bi.cost_category_id
      WHERE bi.budget_id = $1`,
    [budgetId],
  );
  return sortItems(rows);
}

/** Todas las versiones del proyecto, de la más nueva a la más vieja, con el nombre del creador (aunque esté dado de baja). */
export function loadVersionRows(manager: EntityManager, projectId: string): Promise<BudgetVersionRow[]> {
  return manager.query(
    `SELECT b.id, b.project_id AS "projectId", b.version, b.total_amount::text AS "totalAmount", b.currency,
            b.approval_date::text AS "approvalDate", b.is_current AS "isCurrent", b.superseded_at AS "supersededAt",
            b.created_by AS "createdBy", b.created_at AS "createdAt", u.name AS "createdByName"
       FROM budgets b
       JOIN users u ON u.id = b.created_by
      WHERE b.project_id = $1
      ORDER BY b.version DESC`,
    [projectId],
  );
}

/** Partidas de TODAS las versiones dadas, agrupadas por presupuesto (una sola consulta, sin N+1), en orden estable. */
export async function loadItemsByBudget(manager: EntityManager, budgetIds: string[]): Promise<Map<string, BudgetItemView[]>> {
  const rows: Array<BudgetItemView & { budgetId: string }> = await manager.query(
    `SELECT bi.budget_id AS "budgetId", bi.cost_category_id AS "costCategoryId", cc.name AS "categoryName", bi.amount::text AS amount
       FROM budget_items bi
       JOIN cost_categories cc ON cc.id = bi.cost_category_id
      WHERE bi.budget_id = ANY($1::uuid[])`,
    [budgetIds],
  );
  const byBudget = new Map<string, BudgetItemView[]>();
  for (const { budgetId, ...item } of rows) {
    byBudget.set(budgetId, [...(byBudget.get(budgetId) ?? []), item]);
  }
  return byBudget;
}
