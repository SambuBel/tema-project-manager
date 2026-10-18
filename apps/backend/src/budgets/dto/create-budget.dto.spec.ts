import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateBudgetDto } from './create-budget.dto';

/** Mismo pipe que main.ts: whitelist + transform. */
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const parse = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: CreateBudgetDto }) as Promise<CreateBudgetDto>;
const valid = { totalAmount: '1500000.50', currency: 'ARS', approvalDate: '2026-10-12' };
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

    expect(Object.keys(result).sort()).toEqual(['approvalDate', 'currency', 'totalAmount']);
  });
});
