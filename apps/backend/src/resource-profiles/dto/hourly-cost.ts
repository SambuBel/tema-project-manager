import { normalizeAmount } from '../../budgets/dto/amount';

/**
 * Costo por hora como TEXTO (RNF-19: jamás float). La columna es numeric(12,2): hasta 10 dígitos enteros y 2 decimales
 * (distinto de los importes de presupuesto/costos, que admiten 12 enteros). Solo se reutiliza el normalizador de texto.
 */
export const HOURLY_COST_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** "50" → "50.00". Devuelve el mismo texto si no es válido (lo rechaza la validación, no esta función). */
export function normalizeHourlyCost(value: string): string {
  return HOURLY_COST_PATTERN.test(value) ? normalizeAmount(value) : value;
}
