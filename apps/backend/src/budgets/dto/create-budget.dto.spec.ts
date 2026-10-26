import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateBudgetDto } from './create-budget.dto';

/** Mismo pipe que main.ts: whitelist + transform. */
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const parse = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: CreateBudgetDto }) as Promise<CreateBudgetDto>;
const CAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const valid = {
  totalAmount: '1500000.50',
  currency: 'ARS',
  approvalDate: '2026-10-12',
  items: [{ costCategoryId: CAT_A, amount: '1500000.50' }],
};
const rejectedFields = async (body: Record<string, unknown>): Promise<string[]> => {
  try {
    await parse(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string[] }).message;
  }
  throw new Error('Se esperaba un 400');
};

describe('CreateBudgetDto', () => {
  it('acepta un alta válida', async () => {
    expect(await parse(valid)).toMatchObject(valid);
  });

  describe('totalAmount', () => {
    it.each([
      ['0', '0.00'],
      ['0.00', '0.00'],
      ['1000', '1000.00'],
      ['  1.5 ', '1.50'],
      ['999999999999.99', '999999999999.99'],
    ])('acepta %j y lo normaliza a %s', async (input, expected) => {
      expect((await parse({ ...valid, totalAmount: input })).totalAmount).toBe(expected);
    });

    it.each(['-1', '-0.01', '1.234', '1000000000000', '1,5', '1e3', '', 'abc', '.5', '1.'])('rechaza %j', async (input) => {
      expect((await rejectedFields({ ...valid, totalAmount: input })).join(' ')).toMatch(/importe/i);
    });

    it.each([1500000.5, 0, 1000, null, true, {}])('rechaza un valor que NO es texto (%j): evita floating point', async (input) => {
      expect((await rejectedFields({ ...valid, totalAmount: input })).join(' ')).toMatch(/importe/i);
    });

    it('es obligatorio', async () => {
      const { totalAmount: _omit, ...rest } = valid;
      void _omit;
      expect((await rejectedFields(rest)).join(' ')).toMatch(/importe/i);
    });
  });

  describe('currency', () => {
    it.each([
      ['ARS', 'ARS'],
      [' usd ', 'USD'],
      ['eur', 'EUR'],
      ['Brl', 'BRL'],
    ])('trim + mayúsculas: %j → %s', async (input, expected) => {
      expect((await parse({ ...valid, currency: input })).currency).toBe(expected);
    });

    it.each(['', 'US', 'USDD', 'U$D', 'U D', '123', 'ÑAU', ' ', 'US D'])('rechaza %j', async (input) => {
      expect((await rejectedFields({ ...valid, currency: input })).join(' ')).toMatch(/moneda/i);
    });

    it.each([840, null, ['USD']])('rechaza un valor que no es texto (%j)', async (input) => {
      expect((await rejectedFields({ ...valid, currency: input })).join(' ')).toMatch(/moneda/i);
    });

    it('no hay catálogo todavía: cualquier código de 3 letras es válido', async () => {
      expect((await parse({ ...valid, currency: 'xyz' })).currency).toBe('XYZ');
    });
  });

  describe('approvalDate', () => {
    it.each(['2026-10-12', '2026-02-28', '2028-02-29', '2099-12-31'])('acepta %s (incluidas fechas futuras)', async (input) => {
      expect((await parse({ ...valid, approvalDate: input })).approvalDate).toBe(input);
    });

    it.each(['2026-02-31', '2026-13-01', '2026-00-10', '2026-02-29', '12/10/2026', '2026-10-12T00:00:00Z', '2026-10-12T10:00', '20261012', 'mañana', '', '2026-1-1'])(
      'rechaza %j',
      async (input) => {
        expect((await rejectedFields({ ...valid, approvalDate: input })).join(' ')).toMatch(/fecha/i);
      },
    );

    it('es obligatoria', async () => {
      const { approvalDate: _omit, ...rest } = valid;
      void _omit;
      expect((await rejectedFields(rest)).join(' ')).toMatch(/fecha/i);
    });
  });

  it('descarta campos que el cliente no debe decidir (version, isCurrent, createdBy, supersededAt, projectId)', async () => {
    const result = (await parse({
      ...valid,
      version: 7,
      isCurrent: false,
      createdBy: 'otro-usuario',
      supersededAt: '2026-01-01',
      projectId: 'otro-proyecto',
    })) as unknown as Record<string, unknown>;

    expect(Object.keys(result).sort()).toEqual(['approvalDate', 'currency', 'items', 'totalAmount']);
  });

  describe('items (desglose por rubro)', () => {
    const itemsMessage = async (items: unknown) => (await rejectedFields({ ...valid, items })).join(' | ');

    it('acepta varias partidas y normaliza los importes a 2 decimales', async () => {
      const parsed = await parse({ ...valid, items: [{ costCategoryId: CAT_A, amount: '1000' }, { costCategoryId: CAT_B, amount: ' 500000.5 ' }] });
      expect(parsed.items).toEqual([
        { costCategoryId: CAT_A, amount: '1000.00' },
        { costCategoryId: CAT_B, amount: '500000.50' },
      ]);
    });

    it('es OBLIGATORIO', async () => {
      const { items: _omit, ...rest } = valid;
      void _omit;
      expect((await rejectedFields(rest)).join(' ')).toMatch(/items/);
    });

    it('un array vacío se rechaza', async () => {
      expect(await itemsMessage([])).toMatch(/al menos una partida/);
    });

    it.each([null, 'x', 5, {}])('rechaza items = %j (no es una lista)', async (value) => {
      expect(await itemsMessage(value)).toMatch(/items/);
    });

    it('rechaza más de 100 partidas (protección técnica, no un requisito del cliente)', async () => {
      const many = Array.from({ length: 101 }, () => ({ costCategoryId: CAT_A, amount: '1.00' }));
      expect(await itemsMessage(many)).toMatch(/100/);
      await expect(parse({ ...valid, items: many.slice(0, 100) })).resolves.toBeDefined();
    });

    it.each(['no-es-uuid', '', 123, null])('costCategoryId inválido (%j)', async (value) => {
      expect(await itemsMessage([{ costCategoryId: value, amount: '1.00' }])).toMatch(/costCategoryId/);
    });

    it.each([1500, 0, null, true])('amount que NO es texto (%j): evita floating point', async (value) => {
      expect(await itemsMessage([{ costCategoryId: CAT_A, amount: value }])).toMatch(/partida/);
    });

    it.each(['-1', '-0.01', '1.234', '1000000000000', '1,5', '1e3', '', 'abc', '.5'])('amount inválido %j (negativo, 3 decimales, 13 enteros...)', async (value) => {
      expect(await itemsMessage([{ costCategoryId: CAT_A, amount: value }])).toMatch(/partida/);
    });

    it('amount es obligatorio en cada partida', async () => {
      expect(await itemsMessage([{ costCategoryId: CAT_A }])).toMatch(/partida/);
    });

    it('acepta 0.00 y el máximo de la columna', async () => {
      await expect(parse({ ...valid, items: [{ costCategoryId: CAT_A, amount: '0' }, { costCategoryId: CAT_B, amount: '999999999999.99' }] })).resolves.toBeDefined();
    });

    it('descarta campos desconocidos de la partida (moneda propia, id, etc.)', async () => {
      const parsed = await parse({ ...valid, items: [{ costCategoryId: CAT_A, amount: '1.00', currency: 'USD', id: 'x' }] });
      expect(parsed.items[0]).toEqual({ costCategoryId: CAT_A, amount: '1.00' });
    });
  });
});
