import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateResourceProfileDto } from './create-resource-profile.dto';
import { HOURLY_COST_PATTERN, normalizeHourlyCost } from './hourly-cost';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const parse = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: CreateResourceProfileDto }) as Promise<CreateResourceProfileDto>;
const valid = { name: 'Consultor Senior', hourlyCost: '50.00', currency: 'USD' };
const messages = async (body: Record<string, unknown>): Promise<string> => {
  try {
    await parse(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string[] }).message.join(' | ');
  }
  throw new Error('Se esperaba un 400');
};
const without = (key: string) => {
  const copy: Record<string, unknown> = { ...valid };
  delete copy[key];
  return copy;
};

describe('CreateResourceProfileDto', () => {
  it('acepta un alta válida', async () => {
    expect(await parse(valid)).toMatchObject(valid);
  });

  describe('name', () => {
    it('hace trim y NO cambia las mayúsculas', async () => {
      expect((await parse({ ...valid, name: '  Consultor Senior  ' })).name).toBe('Consultor Senior');
      expect((await parse({ ...valid, name: 'consultor SENIOR' })).name).toBe('consultor SENIOR');
    });
    it('es obligatorio: ausente, vacío, solo espacios, null o no-texto', async () => {
      expect(await messages(without('name'))).toMatch(/nombre es obligatorio/);
      for (const value of ['', '   ', null, 5, {}]) expect(await messages({ ...valid, name: value })).toMatch(/nombre es obligatorio/);
    });
    it('acepta 150 y rechaza 151', async () => {
      await expect(parse({ ...valid, name: 'x'.repeat(150) })).resolves.toBeDefined();
      expect(await messages({ ...valid, name: 'x'.repeat(151) })).toMatch(/150/);
    });
  });

  describe('hourlyCost', () => {
    it.each([['0', '0.00'], ['0.00', '0.00'], ['50', '50.00'], ['50.5', '50.50'], ['50.25', '50.25'], ['  7 ', '7.00'], ['9999999999.99', '9999999999.99']])(
      'acepta %j → %s (0 es válido)',
      async (input, expected) => {
        expect((await parse({ ...valid, hourlyCost: input })).hourlyCost).toBe(expected);
      },
    );
    it.each(['-1', '-0.01', '50.123', '10000000000', '99999999999.99', '1,5', '1e3', '', 'abc', '.5', '5.'])('rechaza %j (negativo, 3 decimales, más de 10 enteros...)', async (input) => {
      expect(await messages({ ...valid, hourlyCost: input })).toMatch(/costo por hora/i);
    });
    it.each([50, 0, 50.25, null, true, {}])('rechaza un valor que NO es texto (%j): evita floating point', async (input) => {
      expect(await messages({ ...valid, hourlyCost: input })).toMatch(/costo por hora/i);
    });
    it('es obligatorio', async () => {
      expect(await messages(without('hourlyCost'))).toMatch(/costo por hora/i);
    });
  });

  describe('currency', () => {
    it.each([['USD', 'USD'], [' ars ', 'ARS']])('trim + mayúsculas: %j → %s', async (input, expected) => {
      expect((await parse({ ...valid, currency: input })).currency).toBe(expected);
    });
    it.each(['', 'US', 'USDD', 'U$D', '123', 'ÑAU', ' ', 'US D', 5, null, 'EUR', 'XYZ'])('rechaza %j', async (input) => {
      expect(await messages({ ...valid, currency: input })).toMatch(/moneda/i);
    });
    it('es obligatoria', async () => {
      expect(await messages(without('currency'))).toMatch(/moneda/i);
    });
  });

  it('descarta lo que no se acepta (id, active, revision, createdAt, updatedAt)', async () => {
    const parsed = (await parse({ ...valid, id: 'x', active: false, revision: 9, createdAt: 'x', updatedAt: 'x' })) as unknown as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['currency', 'hourlyCost', 'name']);
  });
});

describe('normalizeHourlyCost (costo por hora como texto)', () => {
  it('completa los decimales: "50" → "50.00" y "12.5" → "12.50"', () => {
    expect(normalizeHourlyCost('50')).toBe('50.00');
    expect(normalizeHourlyCost('12.5')).toBe('12.50');
  });

  it('quita ceros a la izquierda: "007.5" → "7.50"', () => {
    expect(normalizeHourlyCost('007.5')).toBe('7.50');
  });

  it('devuelve el mismo texto si no es válido (lo rechaza la validación, no la función)', () => {
    expect(normalizeHourlyCost('abc')).toBe('abc');
    expect(normalizeHourlyCost('1.234')).toBe('1.234');
    expect(normalizeHourlyCost('-5')).toBe('-5');
  });

  it('admite hasta 10 dígitos enteros y rechaza 11', () => {
    expect(HOURLY_COST_PATTERN.test('9999999999.99')).toBe(true);
    expect(HOURLY_COST_PATTERN.test('10000000000')).toBe(false);
  });
});
