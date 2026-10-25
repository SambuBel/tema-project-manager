import type { Cost } from '@tema/shared-types';

/** Contrato de respuesta (la forma vive en @tema/shared-types). Importes como texto con 2 decimales, fechas funcionales YYYY-MM-DD. */
export class CostResponseDto implements Cost {
  id!: string;
  projectId!: string;
  taskId!: string | null;
  taskTitle!: string | null;
  costCategoryId!: string;
  categoryName!: string;
  amount!: string;
  currency!: string;
  costDate!: string;
  description!: string;
  createdBy!: string;
  createdByUser!: { id: string; name: string };
  createdAt!: string;
  updatedAt!: string;
  revision!: number;
}

/** Fila cruda de la consulta del listado (ya con los importes y fechas como texto). */
export interface CostRow {
  id: string;
  projectId: string;
  taskId: string | null;
  taskTitle: string | null;
  costCategoryId: string;
  categoryName: string;
  amount: string;
  currency: string;
  costDate: string;
  description: string;
  createdBy: string;
  createdByName: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  revision: number;
}

export function toCostResponse(row: CostRow): CostResponseDto {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    costCategoryId: row.costCategoryId,
    categoryName: row.categoryName,
    amount: row.amount,
    currency: row.currency,
    costDate: row.costDate,
    description: row.description,
    createdBy: row.createdBy,
    createdByUser: { id: row.createdBy, name: row.createdByName },
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    revision: row.revision,
  };
}
