import type { Budget, CostCategory, CreateBudgetDto, CreateBudgetVersionDto } from '@tema/shared-types';
import { fromMinorUnits, normalizeAmountInput, sumAmounts, toMinorUnits } from './money';
import { parseLocalDate } from './dates';

/**
 * Lógica PURA del formulario de presupuesto (crear y nueva versión). Todo importe es texto; las sumas son exactas (BigInt).
 * Es ayuda de UX: el backend vuelve a validar y es la única autoridad (suma exacta, rubros activos y sin repetir, versión).
 */

export interface BudgetFormItem {
  /** Id local de la fila (no es el id del backend): estable mientras el usuario agrega y borra filas. */
  key: string;
  costCategoryId: string;
  /** Importe tal como lo tipea el usuario. */
  amount: string;
  /** Nombre histórico de una partida prellenada; sirve para mostrar un rubro que ya no está activo. */
  categoryName?: string;
}

export interface BudgetFormState {
  totalAmount: string;
  currency: string;
  approvalDate: string;
  items: BudgetFormItem[];
}

let nextKey = 0;
export function newItemKey(): string {
  nextKey += 1;
  return `item-${nextKey}`;
}

export function emptyItem(): BudgetFormItem {
  return { key: newItemKey(), costCategoryId: '', amount: '' };
}

/**
 * Creación: todo vacío, con una partida lista para completar. La moneda NO se elige: es la ÚNICA del proyecto (viene de
 * `Project.economicCurrency`) y solo se usa para mostrarla.
 */
export function emptyBudgetForm(projectCurrency: string): BudgetFormState {
  return { totalAmount: '', currency: projectCurrency, approvalDate: '', items: [emptyItem()] };
}

/** Nueva versión: se prellena con el presupuesto vigente MÁS RECIENTE (incluye el nombre histórico de cada rubro). */
export function budgetFormFromCurrent(current: Budget): BudgetFormState {
  return {
    totalAmount: current.totalAmount,
    currency: current.currency,
    approvalDate: current.approvalDate,
    items: current.items.map((item) => ({ key: newItemKey(), costCategoryId: item.costCategoryId, amount: item.amount, categoryName: item.categoryName })),
  };
}

/**
 * Partidas cuyo rubro ya no está entre los activos del catálogo (el backend no las acepta en una versión nueva).
 * `activeCategories === null` = el catálogo todavía no cargó: no se puede afirmar que algo esté inactivo, así que no se marca nada.
 */
export function inactiveCategoryKeys(state: BudgetFormState, activeCategories: readonly CostCategory[] | null): Set<string> {
  if (activeCategories === null) return new Set();
  const active = new Set(activeCategories.map((c) => c.id));
  return new Set(state.items.filter((item) => item.costCategoryId !== '' && !active.has(item.costCategoryId)).map((item) => item.key));
}

/** Rubros elegidos en más de una fila (solo UX: el backend rechaza duplicados con BUDGET_ITEM_DUPLICATED_CATEGORY). */
export function duplicatedCategoryIds(state: BudgetFormState): Set<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const item of state.items) {
    if (item.costCategoryId === '') continue;
    if (seen.has(item.costCategoryId)) duplicated.add(item.costCategoryId);
    seen.add(item.costCategoryId);
  }
  return duplicated;
}

export type SumStatus =
  | { kind: 'incomplete' } // total inválido/vacío o partidas con importes vacíos o inválidos
  | { kind: 'match' }
  | { kind: 'missing'; difference: string } // faltan para llegar al total
  | { kind: 'excess'; difference: string }; // se pasan del total

export interface SumSummary {
  /** Suma exacta de las partidas completas, como texto canónico con 2 decimales. */
  itemsTotal: string;
  status: SumStatus;
}

export function summarizeSum(state: BudgetFormState): SumSummary {
  const sum = sumAmounts(state.items.map((item) => item.amount));
  const itemsTotal = fromMinorUnits(sum.units);
  const total = normalizeAmountInput(state.totalAmount);
  const totalUnits = total === null ? null : toMinorUnits(total);
  if (totalUnits === null || sum.invalid > 0 || sum.blank > 0) return { itemsTotal, status: { kind: 'incomplete' } };
  if (sum.units === totalUnits) return { itemsTotal, status: { kind: 'match' } };
  return sum.units < totalUnits
    ? { itemsTotal, status: { kind: 'missing', difference: fromMinorUnits(totalUnits - sum.units) } }
    : { itemsTotal, status: { kind: 'excess', difference: fromMinorUnits(sum.units - totalUnits) } };
}

export interface BudgetFormIssues {
  /** Mensajes que impiden guardar, en el orden en que conviene resolverlos. */
  blocking: string[];
  fieldErrors: { totalAmount?: string; approvalDate?: string; items?: string };
  itemErrors: Record<string, string>;
}

export function validateBudgetForm(state: BudgetFormState, activeCategories: readonly CostCategory[] | null): BudgetFormIssues {
  const fieldErrors: BudgetFormIssues['fieldErrors'] = {};
  const itemErrors: Record<string, string> = {};
  const blocking: string[] = [];

  if (normalizeAmountInput(state.totalAmount) === null) fieldErrors.totalAmount = 'Ingresá un importe válido (hasta 12 enteros y 2 decimales).';
  if (parseLocalDate(state.approvalDate) === null) fieldErrors.approvalDate = 'Ingresá una fecha válida.';
  if (state.items.length === 0) fieldErrors.items = 'Agregá al menos una partida.';

  const inactive = inactiveCategoryKeys(state, activeCategories);
  const duplicated = duplicatedCategoryIds(state);
  for (const item of state.items) {
    if (item.costCategoryId === '') itemErrors[item.key] = 'Elegí un rubro.';
    else if (inactive.has(item.key)) itemErrors[item.key] = 'Este rubro está inactivo y no se puede usar en una versión nueva. Reemplazalo por otro rubro o eliminá la partida.';
    else if (duplicated.has(item.costCategoryId)) itemErrors[item.key] = 'Este rubro ya está en otra partida.';
    else if (normalizeAmountInput(item.amount) === null) itemErrors[item.key] = 'Ingresá un importe válido.';
  }

  if (fieldErrors.totalAmount) blocking.push('Completá el total del presupuesto.');
  if (fieldErrors.approvalDate) blocking.push('Completá la fecha de aprobación.');
  if (fieldErrors.items) blocking.push(fieldErrors.items);
  if (inactive.size > 0) blocking.push('Reemplazá o eliminá las partidas con rubro inactivo.');
  if (Object.keys(itemErrors).length > 0 && inactive.size === 0) blocking.push('Revisá las partidas marcadas.');
  const sum = summarizeSum(state);
  if (sum.status.kind === 'missing' || sum.status.kind === 'excess') blocking.push('La suma de las partidas debe coincidir con el total.');

  return { blocking, fieldErrors, itemErrors };
}

function toItems(state: BudgetFormState): CreateBudgetDto['items'] {
  return state.items.map((item) => ({ costCategoryId: item.costCategoryId, amount: normalizeAmountInput(item.amount) ?? item.amount.trim() }));
}

/**
 * Request de creación: importes normalizados a texto canónico (nunca Number). NO envía moneda: el presupuesto siempre usa la del
 * proyecto y la deriva el backend (una sola fuente de verdad).
 */
export function toCreateDto(state: BudgetFormState): CreateBudgetDto {
  return {
    totalAmount: normalizeAmountInput(state.totalAmount) ?? state.totalAmount.trim(),
    approvalDate: state.approvalDate,
    items: toItems(state),
  };
}

/** Request de nueva versión: el mismo snapshot completo más `expectedVersion` (la versión vigente que el usuario tenía). */
export function toVersionDto(state: BudgetFormState, expectedVersion: number): CreateBudgetVersionDto {
  return { expectedVersion, ...toCreateDto(state) };
}
