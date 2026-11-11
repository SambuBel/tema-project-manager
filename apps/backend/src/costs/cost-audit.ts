import { EntityManager } from 'typeorm';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { AuditEntityType, AuditOrigin } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateCostDto } from './dto/create-cost.dto';
import { EditableField } from './cost-queries';
import { CostState, CurrentBudget, CurrentCost, DateConfirmations, LockedCategory } from './cost-types';

/** `audit_logs.action` es texto libre; misma convención <ENTIDAD>_<VERBO> que BUDGET_CREATED. */
export const COST_CREATED_ACTION = 'COST_CREATED';

export const COST_UPDATED_ACTION = 'COST_UPDATED';

/** Auditoría COST_CREATED en `audit_logs` (NUNCA en `project_activities`: RN-25), en la misma transacción que el costo. */
export async function recordCostCreated(
  manager: EntityManager,
  costId: string,
  projectId: string,
  dto: CreateCostDto,
  user: RequestUser,
  category: LockedCategory,
  currency: string,
  budget: CurrentBudget,
  confirmations: DateConfirmations,
): Promise<void> {
  await manager.save(
    manager.create(AuditLogEntity, {
      entityType: AuditEntityType.COST,
      entityId: costId,
      action: COST_CREATED_ACTION,
      userId: user.id,
      origin: AuditOrigin.UI,
      oldValues: null,
      newValues: {
        projectId,
        taskId: dto.taskId ?? null,
        costCategoryId: category.id,
        categoryName: category.name,
        amount: dto.amount,
        currency,
        costDate: dto.costDate,
        description: dto.description,
        // Versión del presupuesto vigente contra la que se validó el rubro (el costo NO referencia a budgets).
        budgetVersion: budget.version,
        confirmedBeforeProjectStart: confirmations.confirmedBeforeProjectStart,
        confirmedAfterProjectEnd: confirmations.confirmedAfterProjectEnd,
      },
    }),
  );
}

/** Auditoría COST_UPDATED en `audit_logs` (NUNCA en `project_activities`: RN-25), en la misma transacción que el UPDATE. */
export async function recordCostUpdated(
  manager: EntityManager,
  projectId: string,
  costId: string,
  user: RequestUser,
  current: CurrentCost,
  next: CostState,
  categoryName: string,
  newRevision: number,
  change: { changedFields: readonly EditableField[]; categoryValidatedAgainstBudgetVersion: number | null } & DateConfirmations,
): Promise<void> {
  const snapshot = (state: CostState, name: string, revision: number) => ({
    projectId,
    taskId: state.taskId,
    costCategoryId: state.costCategoryId,
    categoryName: name,
    amount: state.amount,
    currency: state.currency,
    costDate: state.costDate,
    description: state.description,
    revision,
  });
  await manager.save(
    manager.create(AuditLogEntity, {
      entityType: AuditEntityType.COST,
      entityId: costId,
      action: COST_UPDATED_ACTION,
      userId: user.id,
      origin: AuditOrigin.UI,
      oldValues: snapshot(current, current.categoryName, current.revision),
      newValues: { ...snapshot(next, categoryName, newRevision), change },
    }),
  );
}
