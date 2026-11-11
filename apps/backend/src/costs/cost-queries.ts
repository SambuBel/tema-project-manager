/** Costo + nombres para mostrar. Importes y fechas como texto; `deleted_at IS NULL` lo agrega quien consulta (ver abajo). */
export const COST_SELECT = `
  SELECT c.id, c.project_id AS "projectId", c.task_id AS "taskId", t.title AS "taskTitle",
         c.cost_category_id AS "costCategoryId", cc.name AS "categoryName", c.amount::text AS amount, c.currency,
         c.cost_date::text AS "costDate", c.description, c.created_by AS "createdBy", u.name AS "createdByName",
         c.created_at AS "createdAt", c.updated_at AS "updatedAt", c.revision
    FROM costs c
    JOIN cost_categories cc ON cc.id = c.cost_category_id
    JOIN users u ON u.id = c.created_by
    LEFT JOIN tasks t ON t.id = c.task_id`;

/** Campos editables, en el orden determinístico en que se informan en `changedFields` de la auditoría. */
export const EDITABLE_FIELDS = ['costDate', 'amount', 'costCategoryId', 'description', 'taskId'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export const EDITABLE_COLUMNS: Record<EditableField, string> = {
  costDate: 'cost_date',
  amount: 'amount',
  costCategoryId: 'cost_category_id',
  description: 'description',
  taskId: 'task_id',
};
