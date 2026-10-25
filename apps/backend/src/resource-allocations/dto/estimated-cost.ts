import { formatCents, normalizeAmount, sumAmounts, toCents } from '../../budgets/dto/amount';

/**
 * POLÍTICA DE REDONDEO (decisión definitiva de TEMA): cada asignación se redondea a 2 decimales y los totales suman esos
 * importes ya redondeados. Redondeo HALF-UP para importes positivos, que es lo que hace `round(numeric, 2)` de PostgreSQL
 * (mitad hacia arriba para valores no negativos); la base además exige (CHECK) que el costo guardado coincida con ese round().
 * Todo con enteros BigInt: jamás Number, parseFloat ni Math.round.
 */
export const ROUNDING_POLICY = 'HALF_UP_2_DECIMALS_PER_ALLOCATION';

/** Horas: numeric(8,2) → hasta 6 dígitos enteros y 2 decimales. */
export const HOURS_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;

/** "125.5" → "125.50". Devuelve el mismo texto si no es válido (lo rechaza la validación, no esta función). */
export function normalizeHours(value: string): string {
  return HOURS_PATTERN.test(value) ? normalizeAmount(value) : value;
}

/**
 * horas (escala 2) × tarifa por hora (escala 2) = producto exacto de escala 4, redondeado HALF-UP a escala 2.
 * Ej.: 125.50 × 50.25 → 12550 × 5025 = 63063750 → (63063750 + 50) / 100 = 630638 → "6306.38".
 */
export function calculateEstimatedCost(hours: string, hourlyCost: string): string {
  const product = toCents(hours) * toCents(hourlyCost); // escala 4, exacto
  return formatCents((product + 50n) / 100n); // HALF-UP (la división entera trunca; los valores son >= 0)
}

/** Suma de importes YA redondeados (por moneda los agrupa quien llama). */
export function sumEstimatedCosts(amounts: string[]): string {
  return sumAmounts(amounts);
}
