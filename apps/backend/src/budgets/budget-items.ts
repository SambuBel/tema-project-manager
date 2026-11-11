import { BadRequestException } from '@nestjs/common';
import { BudgetCode } from './budget-error-codes';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { CreateBudgetItemDto } from './dto/create-budget-item.dto';
import { normalizeAmount } from './dto/amount';
import { itemsTotal } from './dto/budget-snapshot';

/**
 * Validaciones del desglose que no necesitan la base (se hacen antes de abrir la transacción): sin rubros repetidos y
 * SUM(partidas) == totalAmount con aritmética exacta en centavos (BigInt, nunca Number).
 */
export function prepareItems(dto: CreateBudgetDto): CreateBudgetItemDto[] {
  const items = dto.items.map((item) => ({ costCategoryId: item.costCategoryId, amount: normalizeAmount(item.amount) }));

  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const item of items) {
    if (seen.has(item.costCategoryId)) repeated.add(item.costCategoryId);
    seen.add(item.costCategoryId);
  }
  if (repeated.size > 0) {
    throw new BadRequestException({
      code: BudgetCode.ITEM_DUPLICATED_CATEGORY,
      message: 'Hay rubros repetidos en el desglose. Cada rubro puede aparecer una sola vez.',
      costCategoryIds: [...repeated],
    });
  }

  const total = itemsTotal(items);
  if (total !== dto.totalAmount) {
    throw new BadRequestException({
      code: BudgetCode.ITEMS_TOTAL_MISMATCH,
      message: 'La suma de las partidas debe ser igual al importe total del presupuesto.',
      totalAmount: dto.totalAmount,
      itemsTotal: total,
    });
  }
  return items;
}
