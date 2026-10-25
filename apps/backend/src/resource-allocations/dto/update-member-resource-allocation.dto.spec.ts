import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateMemberResourceAllocationDto } from './update-member-resource-allocation.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const parse = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: UpdateMemberResourceAllocationDto }) as Promise<UpdateMemberResourceAllocationDto>;
const PROFILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const messages = async (body: Record<string, unknown>): Promise<string> => {
  try {
    await parse(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string[] }).message.join(' | ');
  }
  throw new Error('Se esperaba un 400');
};
const defined = (dto: object) => Object.entries(dto).filter(([, v]) => v !== undefined).map(([k]) => k).sort();

describe('UpdateMemberResourceAllocationDto', () => {
  describe('expectedRevision (obligatorio)', () => {
    it('acepta 0 (primera asignación) y revisiones vigentes', async () => {
      expect((await parse({ expectedRevision: 0, estimatedHours: '1' })).expectedRevision).toBe(0);
      expect((await parse({ expectedRevision: 7, estimatedHours: '1' })).expectedRevision).toBe(7);
    });
    it('ausente', async () => {
      expect(await messages({ estimatedHours: '1' })).toMatch(/expectedRevision/);
    });
    it.each([-1, 1.5, '1', null, true, NaN, {}])('rechaza %j', async (value) => {
      expect(await messages({ expectedRevision: value, estimatedHours: '1' })).toMatch(/expectedRevision/);
    });
  });

  describe('estimatedHours', () => {
    it.each([['0', '0.00'], ['0.00', '0.00'], ['125.5', '125.50'], ['  120 ', '120.00'], ['999999.99', '999999.99']])('acepta %j → %s (0 es válido)', async (input, expected) => {
      expect((await parse({ expectedRevision: 0, estimatedHours: input })).estimatedHours).toBe(expected);
    });
    it.each(['-1', '-0.01', '1.234', '1000000', '1,5', '1e3', '', 'abc', '.5'])('rechaza %j (negativo, 3 decimales, 7 enteros...)', async (input) => {
      expect(await messages({ expectedRevision: 0, estimatedHours: input })).toMatch(/horas estimadas/i);
    });
    it.each([120, 0, 125.5, true, {}])('rechaza un valor que NO es texto (%j): evita floating point', async (input) => {
      expect(await messages({ expectedRevision: 0, estimatedHours: input })).toMatch(/horas estimadas/i);
    });
    it('null quita las horas; omitido las conserva', async () => {
      expect((await parse({ expectedRevision: 1, estimatedHours: null })).estimatedHours).toBeNull();
      expect((await parse({ expectedRevision: 1, resourceProfileId: PROFILE })).estimatedHours).toBeUndefined();
    });
  });

  describe('resourceProfileId', () => {
    it('UUID asigna, null quita, omitido conserva', async () => {
      expect((await parse({ expectedRevision: 0, resourceProfileId: PROFILE })).resourceProfileId).toBe(PROFILE);
      expect((await parse({ expectedRevision: 1, resourceProfileId: null })).resourceProfileId).toBeNull();
      expect((await parse({ expectedRevision: 1, estimatedHours: '1' })).resourceProfileId).toBeUndefined();
    });
    it.each(['no-uuid', '', 5, true])('rechaza %j', async (input) => {
      expect(await messages({ expectedRevision: 0, resourceProfileId: input })).toMatch(/resourceProfileId/);
    });
  });

  it('perfil y horas son independientes: se aceptan juntos, por separado o ninguno (el "sin cambios" lo decide el servicio)', async () => {
    expect(defined(await parse({ expectedRevision: 0, resourceProfileId: PROFILE, estimatedHours: '1' }))).toEqual(['estimatedHours', 'expectedRevision', 'resourceProfileId']);
    expect(defined(await parse({ expectedRevision: 0 }))).toEqual(['expectedRevision']);
  });

  it('descarta lo que decide el servidor o no es editable (changedBy, origin, revision, budgetId, tarifa, costo, id...)', async () => {
    const parsed = await parse({
      expectedRevision: 0, estimatedHours: '1', changedBy: 'x', origin: 'AI', revision: 9, budgetId: 'x', hourlyCostSnapshot: '99.00',
      currencySnapshot: 'USD', estimatedCostSnapshot: '1.00', profileNameSnapshot: 'x', isCurrent: false, id: 'x', projectMemberId: 'x',
    });
    expect(defined(parsed)).toEqual(['estimatedHours', 'expectedRevision']);
  });
});
