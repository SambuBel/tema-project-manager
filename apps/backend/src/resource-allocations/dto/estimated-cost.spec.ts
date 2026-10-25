import { ROUNDING_POLICY, calculateEstimatedCost, normalizeHours, sumEstimatedCosts } from './estimated-cost';

describe('calculateEstimatedCost (BigInt, HALF-UP por asignación)', () => {
  it('ejemplo de TEMA: 125.50 h × 50.25 = 6306.3750 → 6306.38', () => {
    expect(calculateEstimatedCost('125.50', '50.25')).toBe('6306.38');
  });

  it.each([
    // hours × rate con tercer decimal exactamente 5: HALF-UP sube
    ['0.01', '0.50', '0.01'], // 0.0050 → 0.01
    ['0.03', '0.50', '0.02'], // 0.0150 → 0.02
    ['0.05', '0.50', '0.03'], // 0.0250 → 0.03
    ['0.01', '0.49', '0.00'], // 0.0049 → 0.00
    ['0.01', '0.51', '0.01'], // 0.0051 → 0.01
  ])('%s h × %s = %s (HALF-UP)', (hours, rate, expected) => {
    expect(calculateEstimatedCost(hours, rate)).toBe(expected);
  });

  it.each([
    ['100.00', '50.00', '5000.00'],
    ['120.00', '50.00', '6000.00'],
    ['120.00', '80.00', '9600.00'],
    ['0.00', '50.00', '0.00'],
    ['100.00', '0.00', '0.00'],
    ['0.00', '0.00', '0.00'],
    ['1', '1', '1.00'],
  ])('%s h × %s = %s', (hours, rate, expected) => {
    expect(calculateEstimatedCost(hours, rate)).toBe(expected);
  });

  it('el máximo posible (999999.99 h × 9999999999.99) es exacto y cabe en numeric(18,2)', () => {
    const cost = calculateEstimatedCost('999999.99', '9999999999.99'); // producto exacto 9999999899990000.0001
    expect(cost).toBe('9999999899990000.00');
    expect(cost.replace('.', '').length).toBeLessThanOrEqual(18);
  });

  it('es exacto donde el float falla (0.1 × 3 horas a 0.10 de tarifa)', () => {
    expect(0.1 * 0.2).not.toBe(0.02);
    expect(calculateEstimatedCost('0.10', '0.20')).toBe('0.02');
  });

  it('rechaza lo que no es un importe válido (no adivina)', () => {
    for (const bad of ['', '-1', '1.234', 'abc']) expect(() => calculateEstimatedCost(bad, '1.00')).toThrow();
  });

  it('la política queda explícita', () => {
    expect(ROUNDING_POLICY).toBe('HALF_UP_2_DECIMALS_PER_ALLOCATION');
  });
});

describe('sumEstimatedCosts: suma los importes YA redondeados', () => {
  it('3 miembros de 125.50 × 50.25 suman 18919.14 (6306.38 × 3), no 18919.13', () => {
    const each = calculateEstimatedCost('125.50', '50.25');
    expect(sumEstimatedCosts([each, each, each])).toBe('18919.14');
  });
  it('lista vacía = 0.00', () => {
    expect(sumEstimatedCosts([])).toBe('0.00');
  });
});

describe('normalizeHours', () => {
  it.each([['125.5', '125.50'], ['0', '0.00'], ['  7 '.trim(), '7.00'], ['999999.99', '999999.99']])('%j → %s', (input, expected) => {
    expect(normalizeHours(input)).toBe(expected);
  });
  it.each(['1000000', '-1', '1.234', 'x'])('deja %j como está (lo rechaza la validación)', (input) => {
    expect(normalizeHours(input)).toBe(input);
  });
});
