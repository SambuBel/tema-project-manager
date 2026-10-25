import { describe, expect, it } from 'vitest';
import { formatAmount, formatHours, formatMoney, fromMinorUnits, groupThousands, normalizeAmountInput, sumAmounts, toMinorUnits } from './money';

describe('formatAmount (texto → texto, sin Number)', () => {
  it.each([
    ['0.00', '0,00'],
    ['0', '0,00'],
    ['1000.00', '1.000,00'],
    ['1000000.00', '1.000.000,00'],
    ['1000000.50', '1.000.000,50'],
    ['1000000.5', '1.000.000,50'],
    ['6306.38', '6.306,38'],
    ['999.99', '999,99'],
    ['007.50', '7,50'],
  ])('%s → %s', (input, expected) => {
    expect(formatAmount(input)).toBe(expected);
  });

  it('importes grandes conservan TODOS los dígitos (un Number los redondearía)', () => {
    expect(formatAmount('9999999899990000.00')).toBe('9.999.999.899.990.000,00');
    expect(formatAmount('123456789012.34')).toBe('123.456.789.012,34');
    expect(String(Number('9999999899990000.01'))).not.toBe('9999999899990000.01'); // el float pierde el último decimal
    expect(formatAmount('9999999899990000.01')).toBe('9.999.999.899.990.000,01');
  });

  it('un valor que no es un importe se muestra crudo (no se inventa uno); null/undefined → guion', () => {
    expect(formatAmount('abc')).toBe('abc');
    expect(formatAmount('1.234')).toBe('1.234'); // 3 decimales no es un importe del backend
    expect(formatAmount(null)).toBe('—');
    expect(formatAmount(undefined)).toBe('—');
  });

  it('groupThousands', () => {
    expect(groupThousands('1')).toBe('1');
    expect(groupThousands('1000')).toBe('1.000');
    expect(groupThousands('1234567')).toBe('1.234.567');
  });
});

describe('formatMoney: la moneda va como código, separada, sin símbolo', () => {
  it('ARS 1.000.000,00', () => {
    expect(formatMoney('1000000.00', 'ARS')).toBe('ARS 1.000.000,00');
    expect(formatMoney('6000.00', 'USD')).toBe('USD 6.000,00');
  });
  it('sin moneda, solo el importe; sin importe, guion', () => {
    expect(formatMoney('10.5', '')).toBe('10,50');
    expect(formatMoney(null, 'ARS')).toBe('ARS —');
  });
  it('nunca usa el símbolo $', () => {
    expect(formatMoney('1.00', 'ARS')).not.toContain('$');
  });
});

describe('normalizeAmountInput (lo tipeado → texto canónico para el backend)', () => {
  it.each([
    ['1000', '1000.00'],
    ['1000.5', '1000.50'],
    ['1000,5', '1000.50'],
    ['1000,50', '1000.50'],
    ['  7  ', '7.00'],
    ['0', '0.00'],
    ['007', '7.00'],
    ['999999999999.99', '999999999999.99'],
  ])('%j → %s', (input, expected) => {
    expect(normalizeAmountInput(input)).toBe(expected);
  });
  it.each(['', ' ', 'abc', '-1', '1.234', '1,234', '1.000,00', '1,000.00', '1e3', '.5', '5.', '1000000000000', '1 000'])('rechaza %j', (input) => {
    expect(normalizeAmountInput(input)).toBeNull();
  });
});

describe('unidades mínimas (BigInt)', () => {
  it('toMinorUnits / fromMinorUnits son inversas y exactas', () => {
    expect(toMinorUnits('1234.56')).toBe(123456n);
    expect(toMinorUnits('0.01')).toBe(1n);
    expect(toMinorUnits('7')).toBe(700n);
    expect(toMinorUnits('abc')).toBeNull();
    expect(fromMinorUnits(123456n)).toBe('1234.56');
    expect(fromMinorUnits(5n)).toBe('0.05');
    expect(fromMinorUnits(0n)).toBe('0.00');
    expect(toMinorUnits('9999999899990000.00')).toBe(999999989999000000n);
  });
});

describe('sumAmounts: suma EXACTA sin Number', () => {
  it('0.10 + 0.20 = 0.30 (con float daría 0.30000000000000004)', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    const { units } = sumAmounts(['0.10', '0.20']);
    expect(fromMinorUnits(units)).toBe('0.30');
  });
  it('acepta lo tipeado (coma o punto) y mezcla formatos', () => {
    expect(fromMinorUnits(sumAmounts(['600000', '400000,50', '0.5']).units)).toBe('1000001.00');
  });
  it('importes grandes: 100 partidas del máximo no pierden precisión', () => {
    const { units } = sumAmounts(Array.from({ length: 100 }, () => '999999999999.99'));
    expect(fromMinorUnits(units)).toBe('99999999999999.00');
  });
  it('cuenta los vacíos y los inválidos sin tratarlos como 0', () => {
    expect(sumAmounts(['10', '', 'x', '5'])).toEqual({ units: 1500n, invalid: 1, blank: 1 });
    expect(sumAmounts([])).toEqual({ units: 0n, invalid: 0, blank: 0 });
  });
});

describe('formatHours', () => {
  it.each([['100.00', '100,00 h'], ['120.5', '120,50 h'], ['1200.00', '1.200,00 h'], ['0.00', '0,00 h']])('%s → %s', (raw, expected) => expect(formatHours(raw)).toBe(expected));
  it('sin dato: raya', () => {
    expect(formatHours(null)).toBe('—');
    expect(formatHours('')).toBe('—');
  });
});
