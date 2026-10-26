import { normalizeAmount, sumAmounts } from './amount';

/** Partida tal como se devuelve y se audita: el nombre del rubro viaja desnormalizado (puede cambiar en el catálogo). */
export interface BudgetItemView {
  costCategoryId: string;
  categoryName: string;
  amount: string;
}

/** Orden estable (nombre del rubro y, a igual nombre, id). No depende del orden físico de PostgreSQL. */
export function sortItems<T extends { costCategoryId: string; categoryName: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.categoryName < b.categoryName ? -1 : a.categoryName > b.categoryName ? 1 : a.costCategoryId < b.costCategoryId ? -1 : a.costCategoryId > b.costCategoryId ? 1 : 0,
  );
}

export function itemsTotal(items: Array<{ amount: string }>): string {
  return sumAmounts(items.map((item) => item.amount));
}

/** Forma canónica de un desglose: mapa rubro → importe normalizado, ordenado por id (independiente del orden del request). */
export function canonicalItems(items: Array<{ costCategoryId: string; amount: string }>): string {
  return items
    .map((item) => `${item.costCategoryId}:${normalizeAmount(item.amount)}`)
    .sort()
    .join('|');
}

export interface SnapshotHeader {
  totalAmount: string;
  currency: string;
  approvalDate: string;
}

/** ¿Es el mismo snapshot económico? Encabezado normalizado + mismo conjunto de (rubro, importe), sin importar el orden. */
export function isSameSnapshot(
  a: SnapshotHeader & { items: Array<{ costCategoryId: string; amount: string }> },
  b: SnapshotHeader & { items: Array<{ costCategoryId: string; amount: string }> },
): boolean {
  return (
    normalizeAmount(a.totalAmount) === normalizeAmount(b.totalAmount) &&
    a.currency === b.currency &&
    a.approvalDate === b.approvalDate &&
    canonicalItems(a.items) === canonicalItems(b.items)
  );
}
