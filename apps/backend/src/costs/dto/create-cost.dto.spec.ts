import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateCostDto } from './create-cost.dto';

/** Mismo pipe que main.ts: whitelist + transform. */
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const parse = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: CreateCostDto }) as Promise<CreateCostDto>;
const CAT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const valid = { costDate: '2026-10-25', amount: '150000.50', currency: 'ARS', costCategoryId: CAT, description: 'Licencias de software' };
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

describe('CreateCostDto', () => {
  it('acepta un alta válida', async () => {
    expect(await parse(valid)).toMatchObject(valid);
  });

  describe('amount', () => {
    it.each([['0', '0.00'], ['1000', '1000.00'], ['  1.5 ', '1.50'], ['999999999999.99', '999999999999.99']])('acepta %j y lo normaliza a %s', async (input, expected) => {
      expect((await parse({ ...valid, amount: input })).amount).toBe(expected);
    });
    it.each(['-1', '-0.01', '1.234', '1000000000000', '1,5', '1e3', '', 'abc', '.5'])('rechaza %j', async (input) => {
      expect(await messages({ ...valid, amount: input })).toMatch(/importe/i);
    });
    it.each([150000.5, 0, null, true, {}])('rechaza un valor que NO es texto (%j): evita floating point', async (input) => {
      expect(await messages({ ...valid, amount: input })).toMatch(/importe/i);
    });
    it('es obligatorio', async () => {
      expect(await messages(without('amount'))).toMatch(/importe/i);
    });
  });

  describe('currency', () => {
    it.each([['ARS', 'ARS'], [' usd ', 'USD'], ['eur', 'EUR']])('trim + mayúsculas: %j → %s', async (input, expected) => {
      expect((await parse({ ...valid, currency: input })).currency).toBe(expected);
    });
    it.each(['', 'US', 'USDD', 'U$D', '123', 'ÑAU', ' ', 'US D', 5, null])('rechaza %j', async (input) => {
      expect(await messages({ ...valid, currency: input })).toMatch(/moneda/i);
    });
  });

  describe('costDate', () => {
    it.each(['2026-10-25', '2024-02-29', '2099-12-31'])('acepta %j (también fechas futuras)', async (input) => {
      expect((await parse({ ...valid, costDate: input })).costDate).toBe(input);
    });
    it.each(['2026-02-31', '2026-13-01', '25/10/2026', '2026-10-25T10:00:00Z', '2026-1-5', '', 20261025, null])('rechaza %j', async (input) => {
      expect(await messages({ ...valid, costDate: input })).toMatch(/fecha/i);
    });
    it('es obligatoria', async () => {
      expect(await messages(without('costDate'))).toMatch(/fecha/i);
    });
    it('queda como texto (no se convierte a Date)', async () => {
      expect(typeof (await parse(valid)).costDate).toBe('string');
    });
  });

  describe('description', () => {
    it('hace trim', async () => {
      expect((await parse({ ...valid, description: '  Licencias  ' })).description).toBe('Licencias');
    });
    it('es obligatoria: ausente, vacía o solo espacios', async () => {
      expect(await messages(without('description'))).toMatch(/descripción es obligatoria/);
      expect(await messages({ ...valid, description: '' })).toMatch(/descripción es obligatoria/);
      expect(await messages({ ...valid, description: '    ' })).toMatch(/descripción es obligatoria/);
    });
    it('acepta 500 caracteres y rechaza 501 (tope técnico)', async () => {
      await expect(parse({ ...valid, description: 'x'.repeat(500) })).resolves.toBeDefined();
      expect(await messages({ ...valid, description: 'x'.repeat(501) })).toMatch(/500/);
    });
    it.each([5, null, {}])('rechaza %j (no es texto)', async (input) => {
      expect(await messages({ ...valid, description: input })).toMatch(/descripción/);
    });
  });

  describe('costCategoryId / taskId', () => {
    it.each(['no-uuid', '', 5, null])('costCategoryId inválido %j', async (input) => {
      expect(await messages({ ...valid, costCategoryId: input })).toMatch(/costCategoryId/);
    });
    it('costCategoryId es obligatorio', async () => {
      expect(await messages(without('costCategoryId'))).toMatch(/costCategoryId/);
    });
    it('taskId es opcional', async () => {
      expect((await parse(valid)).taskId).toBeUndefined();
      expect((await parse({ ...valid, taskId: CAT })).taskId).toBe(CAT);
    });
    it.each(['no-uuid', '', 5])('taskId inválido %j', async (input) => {
      expect(await messages({ ...valid, taskId: input })).toMatch(/taskId/);
    });
  });

  describe('confirmBeforeProjectStart', () => {
    it('es opcional y acepta true/false', async () => {
      expect((await parse(valid)).confirmBeforeProjectStart).toBeUndefined();
      expect((await parse({ ...valid, confirmBeforeProjectStart: true })).confirmBeforeProjectStart).toBe(true);
      expect((await parse({ ...valid, confirmBeforeProjectStart: false })).confirmBeforeProjectStart).toBe(false);
    });
    it.each(['true', 1, 'yes', {}])('rechaza %j (debe ser un booleano real)', async (input) => {
      expect(await messages({ ...valid, confirmBeforeProjectStart: input })).toMatch(/confirmBeforeProjectStart/);
    });
  });

  it('descarta lo que decide el servidor o no se acepta del cliente', async () => {
    const result = (await pipe.transform(
      { ...valid, projectId: 'x', createdBy: 'x', updatedAt: 'x', deletedAt: 'x', id: 'x', createdAt: 'x' },
      { type: 'body', metatype: CreateCostDto },
    )) as unknown as Record<string, unknown>;
    const defined = Object.entries(result).filter(([, value]) => value !== undefined).map(([key]) => key);
    expect(defined.sort()).toEqual(['amount', 'costCategoryId', 'costDate', 'currency', 'description']);
  });
});
