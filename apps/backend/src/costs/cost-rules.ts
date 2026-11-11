import { normalizeAmount } from '../budgets/dto/amount';
import { UpdateCostDto } from './dto/update-cost.dto';
import { CostState, CurrentCost, DateConfirmations, OperationTexts } from './cost-types';

export const CREATE_TEXTS: OperationTexts = {
  skippedAction: 'no se registra el costo.',
  noBudget: 'El proyecto no tiene un presupuesto vigente: hay que definirlo antes de registrar costos.',
  inactiveCategory: 'El rubro está inactivo: no se puede usar para registrar costos nuevos.',
  confirmTo: 'registrarlo',
};

export const updateTexts = (costId: string): OperationTexts => ({
  skippedAction: `no se cambia el rubro del costo ${costId}.`,
  noBudget: 'El proyecto no tiene un presupuesto vigente: hay que definirlo antes de cambiar el rubro de un costo.',
  inactiveCategory: 'El rubro está inactivo: no se puede usar para un costo.',
  confirmTo: 'guardarla',
});

export const NO_CONFIRMATIONS: DateConfirmations = { confirmedBeforeProjectStart: false, confirmedAfterProjectEnd: false };

/**
 * Estado resultante de una edición: lo enviado sobre el costo actual. taskId: omitido = conserva, null = quita. El DTO ya normaliza en
 * el borde HTTP; se repite acá (idempotente) para que la comparación "sin cambios" y lo que se escribe sean SIEMPRE la forma
 * canónica, también si el servicio se llama desde otro lado. La moneda no se edita: es la del costo.
 */
export function resolveNextState(current: CurrentCost, dto: UpdateCostDto): CostState {
  return {
    costDate: dto.costDate !== undefined ? dto.costDate.trim() : current.costDate,
    amount: dto.amount !== undefined ? normalizeAmount(dto.amount.trim()) : current.amount,
    currency: current.currency,
    costCategoryId: dto.costCategoryId !== undefined ? dto.costCategoryId.toLowerCase() : current.costCategoryId,
    description: dto.description !== undefined ? dto.description.trim() : current.description,
    taskId: dto.taskId === undefined ? current.taskId : dto.taskId === null ? null : dto.taskId.toLowerCase(),
  };
}
