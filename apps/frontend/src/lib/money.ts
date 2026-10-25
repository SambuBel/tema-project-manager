/**
 * Dinero en el frontend: SIEMPRE texto. El backend entrega y recibe los importes como string decimal exacto ("1000000.50") y
 * la moneda por separado ("ARS"). Nada de acá usa Number/parseFloat: el formato y las sumas trabajan sobre el texto o sobre
 * BigInt en unidades mínimas (centavos), así no se pierde precisión con importes grandes (hasta ~10^16).
 *
 * Estas funciones son SOLO presentación y ayuda de formulario (p. ej. la suma de partidas contra el total). La verdad
 * económica —cálculos, redondeo, validaciones— es siempre del backend.
 */

/** Lo que se acepta al TIPEAR un importe: enteros (hasta 12 dígitos) con hasta 2 decimales, con coma o punto como separador. */
const AMOUNT_INPUT = /^\d{1,12}(?:[.,]\d{1,2})?$/;
/** Lo que entrega el backend (o ya normalizado): entero con 0 a 2 decimales. */
const AMOUNT_CANONICAL = /^\d+(?:\.\d{1,2})?$/;

/** "1000000" → "1.000.000" (separador de miles argentino). */
export function groupThousands(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * "1000000.5" → "1.000.000,50". Un texto que no es un importe se devuelve tal cual (se ve el dato crudo antes que un valor inventado).
 * Sin símbolo de moneda: ver `formatMoney`.
 */
export function formatAmount(amount: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const text = amount.trim();
  if (!AMOUNT_CANONICAL.test(text)) return amount;
  const [integer = '0', decimals = ''] = text.split('.');
  return `${groupThousands(integer.replace(/^0+(?=\d)/, ''))},${decimals.padEnd(2, '0')}`;
}

/** "ARS 1.000.000,00". La moneda va como código y separada, sin "$" (ambiguo con varias monedas). */
export function formatMoney(amount: string | null | undefined, currency: string | null | undefined): string {
  const formatted = formatAmount(amount);
  return currency ? `${currency} ${formatted}` : formatted;
}

/**
 * Lo tipeado → texto canónico para el backend ("1000,5" → "1000.50"), o null si no es un importe válido.
 * Acepta coma o punto SOLO como decimal (los separadores de miles no se tipean).
 */
export function normalizeAmountInput(raw: string): string | null {
  const text = raw.trim();
  if (!AMOUNT_INPUT.test(text)) return null;
  const [integer = '0', decimals = ''] = text.replace(',', '.').split('.');
  return `${integer.replace(/^0+(?=\d)/, '')}.${decimals.padEnd(2, '0')}`;
}

/** "1234.56" → 123456n (unidades mínimas). null si no es un importe canónico. */
export function toMinorUnits(amount: string): bigint | null {
  const text = amount.trim();
  if (!AMOUNT_CANONICAL.test(text)) return null;
  const [integer = '0', decimals = ''] = text.split('.');
  return BigInt(integer) * 100n + BigInt(decimals.padEnd(2, '0'));
}

/** 123456n → "1234.56". */
export function fromMinorUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const text = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/**
 * Suma exacta de importes tipeados o canónicos. `invalid` cuenta los que no son importes válidos (se ignoran en la suma) y
 * `blank` los vacíos: así el formulario puede avisar "faltan completar" sin tratarlos como 0.
 */
export function sumAmounts(values: readonly string[]): { units: bigint; invalid: number; blank: number } {
  let units = 0n;
  let invalid = 0;
  let blank = 0;
  for (const value of values) {
    if (value.trim() === '') {
      blank += 1;
      continue;
    }
    const normalized = normalizeAmountInput(value);
    const parsed = normalized === null ? null : toMinorUnits(normalized);
    if (parsed === null) invalid += 1;
    else units += parsed;
  }
  return { units, invalid, blank };
}

/** Horas ya canónicas ("120.00") → "120,00 h". Solo presentación: no hace cuentas. "—" si falta. */
export function formatHours(hours: string | null | undefined): string {
  if (hours === null || hours === undefined || hours === '') return '—';
  return `${formatAmount(hours)} h`;
}
