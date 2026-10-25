import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateCostDto } from './update-cost.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const parse = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: UpdateCostDto }) as Promise<UpdateCostDto>;
const CAT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const messages = async (body: Record<string, unknown>): Promise<string> => {
  try {
    await parse(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string[] }).message.join(' | ');
  }
  throw new Error('Se esperaba un 400');
};
const definedKeys = (dto: object) => Object.entries(dto).filter(([, v]) => v !== undefined).map(([k]) => k).sort();

describe('UpdateCostDto', () => {
  it('basta con expectedRevision y UN campo (PATCH real)', async () => {
    expect(definedKeys(await parse({ expectedRevision: 3, description: ' Corregida ' }))).toEqual(['description', 'expectedRevision']);
    expect((await parse({ expectedRevision: 3, description: ' Corregida ' })).description).toBe('Corregida');
  });

  describe('expectedRevision (obligatorio)', () => {
    it('ausente', async () => {
      expect(await messages({ description: 'x' })).toMatch(/expectedRevision/);
    });
    it.each([0, -1, 1.5, '1', null, true, NaN, {}])('rechaza %j', async (value) => {
      expect(await messages({ expectedRevision: value, description: 'x' })).toMatch(/expectedRevision/);
    });
    it('acepta enteros >= 1', async () => {
      expect((await parse({ expectedRevision: 1 })).expectedRevision).toBe(1);
      expect((await parse({ expectedRevision: 2147483647 })).expectedRevision).toBe(2147483647);
    });
  });

  describe('amount', () => {
    it.each([['0', '0.00'], ['1000', '1000.00'], [' 1.5 ', '1.50'], ['999999999999.99', '999999999999.99']])('acepta %j → %s', async (input, expected) => {
      expect((await parse({ expectedRevision: 1, amount: input })).amount).toBe(expected);
    });
    it.each(['-1', '1.234', '1000000000000', '1,5', 'abc', ''])('rechaza %j', async (input) => {
      expect(await messages({ expectedRevision: 1, amount: input })).toMatch(/importe/i);
    });
    it.each([10, 0, null, true])('rechaza un valor que NO es texto (%j): evita floating point', async (input) => {
      expect(await messages({ expectedRevision: 1, amount: input })).toMatch(/importe/i);
    });
  });

  describe('currency', () => {
    it('trim + mayúsculas', async () => {
      expect((await parse({ expectedRevision: 1, currency: ' usd ' })).currency).toBe('USD');
    });
    it.each(['', 'US', 'USDD', 'U$D', 5, null])('rechaza %j', async (input) => {
      expect(await messages({ expectedRevision: 1, currency: input })).toMatch(/moneda/i);
    });
  });

  describe('costDate', () => {
    it('acepta fechas reales (incluso futuras)', async () => {
      expect((await parse({ expectedRevision: 1, costDate: '2099-12-31' })).costDate).toBe('2099-12-31');
    });
    it.each(['2026-02-31', '25/10/2026', '2026-10-25T10:00:00Z', '', 20261025, null])('rechaza %j', async (input) => {
      expect(await messages({ expectedRevision: 1, costDate: input })).toMatch(/fecha/i);
    });
  });

  describe('description', () => {
    it('no puede ser vacía ni solo espacios, ni null', async () => {
      for (const value of ['', '   ', null]) expect(await messages({ expectedRevision: 1, description: value })).toMatch(/descripción es obligatoria/);
    });
    it('acepta 500 y rechaza 501', async () => {
      await expect(parse({ expectedRevision: 1, description: 'x'.repeat(500) })).resolves.toBeDefined();
      expect(await messages({ expectedRevision: 1, description: 'x'.repeat(501) })).toMatch(/500/);
    });
  });

  describe('costCategoryId / taskId', () => {
    it.each(['no-uuid', '', 5, null])('costCategoryId inválido %j', async (input) => {
      expect(await messages({ expectedRevision: 1, costCategoryId: input })).toMatch(/costCategoryId/);
    });
    it('taskId: UUID asigna, null quita, omitido conserva', async () => {
      expect((await parse({ expectedRevision: 1, taskId: CAT })).taskId).toBe(CAT);
      expect((await parse({ expectedRevision: 1, taskId: null })).taskId).toBeNull();
      expect((await parse({ expectedRevision: 1, description: 'x' })).taskId).toBeUndefined();
    });
    it.each(['no-uuid', '', 5])('taskId inválido %j', async (input) => {
      expect(await messages({ expectedRevision: 1, taskId: input })).toMatch(/taskId/);
    });
  });

  describe('confirmBeforeProjectStart', () => {
    it('booleano real y opcional', async () => {
      expect((await parse({ expectedRevision: 1, confirmBeforeProjectStart: true })).confirmBeforeProjectStart).toBe(true);
      for (const value of ['true', 1, {}]) expect(await messages({ expectedRevision: 1, confirmBeforeProjectStart: value })).toMatch(/confirmBeforeProjectStart/);
    });
  });

  it('descarta lo que no es editable (id, projectId, createdBy, createdAt, updatedAt, deletedAt, revision)', async () => {
    const parsed = await parse({
      expectedRevision: 2, description: 'x', id: 'x', projectId: 'x', createdBy: 'x', createdAt: 'x', updatedAt: 'x', deletedAt: 'x', revision: 99,
    });
    expect(definedKeys(parsed)).toEqual(['description', 'expectedRevision']);
  });
});
