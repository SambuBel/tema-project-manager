import { isValidAmount, normalizeAmount } from './amount';

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
