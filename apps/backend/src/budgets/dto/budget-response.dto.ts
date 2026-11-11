import type { Budget, BudgetHistoryEntry } from '@tema/shared-types';
import { BudgetItemView, sortItems } from './budget-snapshot';
import { BudgetEntity } from '../../database/entities/budget.entity';

/** Contrato de respuesta (la forma vive en @tema/shared-types). `totalAmount` sigue siendo texto con 2 decimales. */
export class BudgetResponseDto implements Budget {
  id!: string;
  projectId!: string;
  version!: number;
  totalAmount!: string;
  currency!: string;
  approvalDate!: string;
  isCurrent!: boolean;
  supersededAt!: string | null;
  createdBy!: string;
  createdAt!: string;
  items!: BudgetItemView[];
}

/** `items` ya viene ordenado de forma estable (ver sortItems). */
export function toBudgetResponse(budget: BudgetEntity, items: BudgetItemView[]): BudgetResponseDto {
  return {
    id: budget.id,
    projectId: budget.projectId,
    version: budget.version,
    totalAmount: budget.totalAmount,
    currency: budget.currency,
    approvalDate: budget.approvalDate,
    isCurrent: budget.isCurrent,
    supersededAt: budget.supersededAt ? budget.supersededAt.toISOString() : null,
    createdBy: budget.createdBy,
    createdAt: budget.createdAt.toISOString(),
    items,
  };
}

/** Versión del historial: la misma forma que `Budget` más el creador (id y nombre). */
export class BudgetHistoryEntryDto extends BudgetResponseDto implements BudgetHistoryEntry {
  createdByUser!: { id: string; name: string };
}

/** Fila cruda de una versión tal como la devuelve la consulta del historial (fechas como las entrega el driver). */
export interface BudgetVersionRow {
  id: string;
  projectId: string;
  version: number;
  totalAmount: string;
  currency: string;
  approvalDate: string;
  isCurrent: boolean;
  supersededAt: Date | null;
  createdBy: string;
  createdAt: Date;
  createdByName: string;
}

export function toHistoryEntry(row: BudgetVersionRow, items: BudgetItemView[]): BudgetHistoryEntryDto {
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    totalAmount: row.totalAmount,
    currency: row.currency,
    approvalDate: row.approvalDate,
    isCurrent: row.isCurrent,
    supersededAt: row.supersededAt ? new Date(row.supersededAt).toISOString() : null,
    createdBy: row.createdBy,
    createdAt: new Date(row.createdAt).toISOString(),
    items: sortItems(items),
    createdByUser: { id: row.createdBy, name: row.createdByName },
  };
}
