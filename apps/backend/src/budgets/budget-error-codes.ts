import type { BudgetErrorCode, CostCategoryErrorCode } from '@tema/shared-types';

/**
 * Valores de `code` que devuelve el módulo de presupuesto. La forma del tipo vive en @tema/shared-types (el frontend la usa para
 * traducirlos); `satisfies` impide declarar acá un valor que el tipo no conozca, y `Record<BudgetErrorCode, ...>` obliga a no
 * olvidar ninguno.
 */
export const BudgetCode = {
  NOT_FOUND: 'BUDGET_NOT_FOUND',
  ALREADY_EXISTS: 'BUDGET_ALREADY_EXISTS',
  VERSION_CONFLICT: 'BUDGET_VERSION_CONFLICT',
  NO_CHANGES: 'BUDGET_NO_CHANGES',
  ITEMS_TOTAL_MISMATCH: 'BUDGET_ITEMS_TOTAL_MISMATCH',
  ITEM_DUPLICATED_CATEGORY: 'BUDGET_ITEM_DUPLICATED_CATEGORY',
  NO_CURRENT_VERSION: 'BUDGET_NO_CURRENT_VERSION',
  VERSION_STATE_INVALID: 'BUDGET_VERSION_STATE_INVALID',
} as const satisfies Record<string, BudgetErrorCode>;

export const CostCategoryCode = {
  NOT_FOUND: 'COST_CATEGORY_NOT_FOUND',
  INACTIVE: 'COST_CATEGORY_INACTIVE',
} as const satisfies Record<string, CostCategoryErrorCode>;

// Completitud: si el tipo compartido tiene un código que acá falta, esta línea no compila.
type Missing = Exclude<BudgetErrorCode, (typeof BudgetCode)[keyof typeof BudgetCode]>;
type Missing2 = Exclude<CostCategoryErrorCode, (typeof CostCategoryCode)[keyof typeof CostCategoryCode]>;
export const _complete: [Missing, Missing2] extends [never, never] ? true : never = true;
