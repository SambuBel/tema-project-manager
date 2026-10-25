import type { Cost, CreateCostDto, UpdateCostDto } from '@tema/shared-types';
import { normalizeAmountInput } from './money';
import { parseLocalDate } from './dates';

/**
 * Lógica PURA del formulario de costos (alta y edición). El importe es siempre texto. Es ayuda de UX: el backend vuelve a
 * validar todo (rubro activo y del presupuesto vigente, tarea del proyecto, RN-21, revisión) y es la única autoridad.
 * Nada acá bloquea un importe por superar el presupuesto (RN-19) ni una fecha futura (pendiente de TEMA).
 */

/** Tope técnico de la descripción (el mismo que el backend, que no es un requisito funcional de TEMA). */
export const MAX_COST_DESCRIPTION_LENGTH = 500;

export interface CostFormState {
  /** YYYY-MM-DD (el valor de <input type="date"> ya viene en ese formato, sin zonas horarias). */
  costDate: string;
  /** Tal como lo tipea el usuario. */
  amount: string;
  costCategoryId: string;
  description: string;
  /** '' = sin tarea. */
  taskId: string;
}

/** Hoy en hora LOCAL como YYYY-MM-DD (nunca toISOString: en UTC-3 de noche daría el día siguiente). */
export function todayLocalIso(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export function emptyCostForm(now: Date = new Date()): CostFormState {
  return { costDate: todayLocalIso(now), amount: '', costCategoryId: '', description: '', taskId: '' };
}

/** Edición: se prellena con el estado ACTUAL que devolvió el detalle (no con la fila de una lista vieja). */
export function costFormFromCost(cost: Cost): CostFormState {
  return {
    costDate: cost.costDate,
    amount: cost.amount,
    costCategoryId: cost.costCategoryId,
    description: cost.description,
    taskId: cost.taskId ?? '',
  };
}

export interface CostFormIssues {
  fieldErrors: Partial<Record<keyof CostFormState, string>>;
  /** Todo lo que impide guardar, para mostrarlo junto al botón. */
  blocking: string[];
}

export function validateCostForm(state: CostFormState): CostFormIssues {
  const fieldErrors: CostFormIssues['fieldErrors'] = {};

  if (state.costDate === '') fieldErrors.costDate = 'Ingresá la fecha del costo.';
  else if (!parseLocalDate(state.costDate)) fieldErrors.costDate = 'La fecha del costo no es válida.';

  if (state.amount.trim() === '') fieldErrors.amount = 'Ingresá el importe.';
  else if (normalizeAmountInput(state.amount) === null) {
    fieldErrors.amount = 'El importe debe ser un número sin signo, con hasta 12 enteros y 2 decimales.';
  }

  if (state.costCategoryId === '') fieldErrors.costCategoryId = 'Elegí un rubro.';

  const description = state.description.trim();
  if (description === '') fieldErrors.description = 'La descripción es obligatoria.';
  else if (description.length > MAX_COST_DESCRIPTION_LENGTH) {
    fieldErrors.description = `La descripción puede tener como máximo ${MAX_COST_DESCRIPTION_LENGTH} caracteres.`;
  }

  return { fieldErrors, blocking: Object.values(fieldErrors) };
}

/** Importe en su forma canónica de 2 decimales (ej. "10000" → "10000.00"). Solo se llama con el formulario ya validado. */
function canonicalAmount(raw: string): string {
  return normalizeAmountInput(raw) ?? raw.trim();
}

/**
 * Alta. NO envía moneda: el costo siempre se registra en la ÚNICA moneda del proyecto y la deriva el backend. `taskId` solo viaja si se eligió una tarea; `confirmBeforeProjectStart` solo en el reenvío confirmado de RN-21. */
export function toCreateCostDto(state: CostFormState, confirmBeforeProjectStart = false): CreateCostDto {
  const dto: CreateCostDto = {
    costDate: state.costDate,
    amount: canonicalAmount(state.amount),
    costCategoryId: state.costCategoryId,
    description: state.description.trim(),
  };
  if (state.taskId !== '') dto.taskId = state.taskId;
  if (confirmBeforeProjectStart) dto.confirmBeforeProjectStart = true;
  return dto;
}

/** Campos del costo que difieren del estado actual del backend (lo único que se envía en el PATCH). */
export function changedCostFields(state: CostFormState, original: Cost): Array<keyof CostFormState> {
  const next = {
    costDate: state.costDate,
    amount: canonicalAmount(state.amount),
    costCategoryId: state.costCategoryId,
    description: state.description.trim(),
    taskId: state.taskId,
  };
  const before = costFormFromCost(original);
  return (Object.keys(next) as Array<keyof CostFormState>).filter((field) => next[field] !== before[field]);
}

/**
 * Edición parcial: solo lo que cambió, más `expectedRevision` (el del detalle recién traído). `taskId: null` quita la tarea;
 * omitirlo la conserva. Sin cambios se envía igual: el backend responde COST_NO_CHANGES y la UI lo muestra como aviso.
 */
export function toUpdateCostDto(state: CostFormState, original: Cost, confirmBeforeProjectStart = false): UpdateCostDto {
  const dto: UpdateCostDto = { expectedRevision: original.revision };
  for (const field of changedCostFields(state, original)) {
    switch (field) {
      case 'costDate':
        dto.costDate = state.costDate;
        break;
      case 'amount':
        dto.amount = canonicalAmount(state.amount);
        break;
      case 'costCategoryId':
        dto.costCategoryId = state.costCategoryId;
        break;
      case 'description':
        dto.description = state.description.trim();
        break;
      case 'taskId':
        dto.taskId = state.taskId === '' ? null : state.taskId;
        break;
    }
  }
  if (confirmBeforeProjectStart) dto.confirmBeforeProjectStart = true;
  return dto;
}
