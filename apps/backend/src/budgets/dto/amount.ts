/**
 * Importes monetarios como TEXTO (RNF-19: jamás float). La columna es numeric(14,2): hasta 12 dígitos enteros y 2
 * decimales. Este módulo solo valida y normaliza el texto; no convierte a number en ningún momento.
 */
export const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export function isValidAmount(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_PATTERN.test(value);
}

/**
 * "1000" → "1000.00", "1.5" → "1.50", "007.5" → "7.50". Devuelve el mismo texto si no es un importe válido
 * (para que lo rechace la validación, no esta función). Opera sobre el string: sin Number/parseFloat.
 */
export function normalizeAmount(value: string): string {
  if (!AMOUNT_PATTERN.test(value)) return value;
  const [integer = '0', decimals = ''] = value.split('.');
  const cleanInteger = integer.replace(/^0+(?=\d)/, '');
  return `${cleanInteger}.${decimals.padEnd(2, '0')}`;
}
