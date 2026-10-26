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

/**
 * Aritmética exacta sobre importes: se trabaja en CENTAVOS con BigInt (RNF-19: nunca Number/parseFloat). Un importe
 * válido ya cabe en 12 enteros + 2 decimales, y la suma de hasta 100 partidas tampoco desborda un BigInt.
 */
export function toCents(amount: string): bigint {
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new Error(`Importe inválido: ${amount}`);
  }
  const normalized = normalizeAmount(amount);
  const [integer = '0', decimals = '00'] = normalized.split('.');
  return BigInt(integer) * 100n + BigInt(decimals);
}

/** 123456n → "1234.56". */
export function formatCents(cents: bigint): string {
  const integer = cents / 100n;
  const decimals = (cents % 100n).toString().padStart(2, '0');
  return `${integer}.${decimals}`;
}

export function sumAmounts(amounts: string[]): string {
  return formatCents(amounts.reduce((total, amount) => total + toCents(amount), 0n));
}
