import type { Budget } from '@tema/shared-types';
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
}

export function toBudgetResponse(budget: BudgetEntity): BudgetResponseDto {
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
  };
}
