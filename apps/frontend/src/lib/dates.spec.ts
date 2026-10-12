import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, formatLocalDate, isSameDay, parseLocalDate, startOfToday } from './dates';

describe('parseLocalDate', () => {
  it('2026-10-11 → 11 de octubre en hora local (00:00)', () => {
    const date = parseLocalDate('2026-10-11')!;
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 9, 11]);
    expect([date.getHours(), date.getMinutes()]).toEqual([0, 0]);
  });

  it.each([null, undefined, '', 'mañana', '2026-10-11T00:00:00Z', '11/10/2026', '2026-1-1'])('%p → null', (value) => {
    expect(parseLocalDate(value)).toBeNull();
  });

  it.each(['2026-02-31', '2026-13-01', '2026-00-10', '2026-04-31'])('fecha de calendario inexistente %s → null', (value) => {
    expect(parseLocalDate(value)).toBeNull();
  });

  it('acepta el 29 de febrero solo en año bisiesto', () => {
    expect(parseLocalDate('2028-02-29')).not.toBeNull();
    expect(parseLocalDate('2026-02-29')).toBeNull();
  });
});

describe('formatLocalDate', () => {
  it('2026-10-11 se muestra como 11/10/2026', () => {
    expect(formatLocalDate('2026-10-11')).toBe('11/10/2026');
  });

  it('acepta un Date y completa con ceros', () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe('05/01/2026');
  });

  it('valores inválidos o vacíos → —', () => {
    expect(formatLocalDate(null)).toBe('—');
    expect(formatLocalDate('basura')).toBe('—');
  });
});

describe('addDays / isSameDay / startOfToday', () => {
  it('suma días cruzando fin de mes y de año', () => {
    expect(formatLocalDate(addDays(parseLocalDate('2026-10-31')!, 1))).toBe('01/11/2026');
    expect(formatLocalDate(addDays(parseLocalDate('2026-12-31')!, 1))).toBe('01/01/2027');
    expect(formatLocalDate(addDays(parseLocalDate('2026-10-11')!, -11))).toBe('30/09/2026');
  });

  it('isSameDay ignora la hora', () => {
    expect(isSameDay(new Date(2026, 9, 11, 0, 0), new Date(2026, 9, 11, 23, 59))).toBe(true);
    expect(isSameDay(new Date(2026, 9, 11), new Date(2026, 9, 12))).toBe(false);
  });

  it('startOfToday devuelve las 00:00 del día dado', () => {
    const date = startOfToday(new Date(2026, 9, 11, 17, 45, 30));
    expect([date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]).toEqual([11, 0, 0, 0]);
  });
});

describe('zona horaria Argentina (UTC-3): el bug de new Date("YYYY-MM-DD")', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('new Date("2026-10-11") cae en el día ANTERIOR (por eso no se usa)', () => {
    expect(new Date('2026-10-11').getDate()).toBe(10);
  });

  it('parseLocalDate("2026-10-11") sigue siendo el 11 y se formatea 11/10/2026, no 10/10/2026', () => {
    expect(parseLocalDate('2026-10-11')!.getDate()).toBe(11);
    expect(formatLocalDate('2026-10-11')).toBe('11/10/2026');
    expect(formatLocalDate('2026-10-11')).not.toBe('10/10/2026');
  });

  it('addDays no se corre aunque el período cruce un cambio de horario', () => {
    expect(formatLocalDate(addDays(parseLocalDate('2026-03-07')!, 30))).toBe('06/04/2026');
  });
});
