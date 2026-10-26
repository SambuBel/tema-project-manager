import { formatCents, isValidAmount, normalizeAmount, sumAmounts, toCents } from './amount';

describe('importes como texto (RNF-19)', () => {
  it.each([
    ['0', '0.00'],
    ['0.00', '0.00'],
    ['1000', '1000.00'],
    ['1.5', '1.50'],
    ['1500000.50', '1500000.50'],
    ['007.5', '7.50'],
    ['000', '0.00'],
    ['999999999999.99', '999999999999.99'],
    ['999999999999', '999999999999.00'],
  ])('normaliza %s → %s', (input, expected) => {
    expect(normalizeAmount(input)).toBe(expected);
  });

  it.each(['', '-1', '-0.01', '+5', '1.234', '1.', '.5', '1,5', '1e3', '0x10', 'abc', ' 5', '1 000', '1000000000000', '1000000000000.00', 'NaN', 'Infinity'])(
    '%j no es un importe válido y se devuelve sin tocar',
    (input) => {
      expect(isValidAmount(input)).toBe(false);
      expect(normalizeAmount(input)).toBe(input);
    },
  );

  it('un number NO es un importe válido (pasaría por floating point)', () => {
    expect(isValidAmount(1500000.5)).toBe(false);
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount(null)).toBe(false);
  });

  it('no pierde dígitos: 12 enteros + 2 decimales exactos (imposible en un double)', () => {
    expect(normalizeAmount('123456789012.34')).toBe('123456789012.34');
    expect(normalizeAmount('0.30')).toBe('0.30');
  });
});

describe('aritmética exacta en centavos (BigInt)', () => {
  it.each([
    ['0', 0n],
    ['0.01', 1n],
    ['1', 100n],
    ['1.5', 150n],
    ['1500000.50', 150000050n],
    ['999999999999.99', 99999999999999n],
  ])('toCents(%j) = %s', (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });

  it.each([-1n, 5n, 99n, 100n, 123456n])('formatCents es la inversa (%s)', (cents) => {
    // los negativos no existen en este dominio; solo se prueban los >= 0
    if (cents >= 0n) expect(toCents(formatCents(cents))).toBe(cents);
  });

  it('formatCents siempre devuelve 2 decimales', () => {
    expect(formatCents(5n)).toBe('0.05');
    expect(formatCents(100n)).toBe('1.00');
    expect(formatCents(123456n)).toBe('1234.56');
  });

  it('toCents rechaza lo que no es un importe válido (no adivina)', () => {
    for (const bad of ['', '-1', '1.234', 'abc', '1e3', '1000000000000']) expect(() => toCents(bad)).toThrow();
  });

  it('la suma de decimales es exacta (0.1 + 0.2 = 0.30, no 0.30000000000000004)', () => {
    expect(sumAmounts(['0.10', '0.20'])).toBe('0.30');
    expect(0.1 + 0.2).not.toBe(0.3); // el float falla; el BigInt no
  });

  it('suma 100 partidas del máximo sin perder precisión ni desbordar', () => {
    const max = '999999999999.99';
    expect(sumAmounts(Array.from({ length: 100 }, () => max))).toBe('99999999999999.00'.replace('99999999999999.00', '99999999999999.00') && formatCents(99999999999999n * 100n));
  });

  it('una lista vacía suma 0.00', () => {
    expect(sumAmounts([])).toBe('0.00');
  });
});
