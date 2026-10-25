import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateResourceProfileDto } from './update-resource-profile.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const parse = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: UpdateResourceProfileDto }) as Promise<UpdateResourceProfileDto>;
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

describe('UpdateResourceProfileDto', () => {
  it('basta con expectedRevision y UN campo (PATCH real)', async () => {
    expect(defined(await parse({ expectedRevision: 2, name: ' Nuevo ' }))).toEqual(['expectedRevision', 'name']);
    expect((await parse({ expectedRevision: 2, name: ' Nuevo ' })).name).toBe('Nuevo');
  });

  describe('expectedRevision (obligatorio)', () => {
    it('ausente', async () => {
      expect(await messages({ name: 'x' })).toMatch(/expectedRevision/);
    });
    it.each([0, -1, 1.5, '1', null, true, NaN, {}])('rechaza %j', async (value) => {
      expect(await messages({ expectedRevision: value, name: 'x' })).toMatch(/expectedRevision/);
    });
    it('acepta enteros >= 1', async () => {
      expect((await parse({ expectedRevision: 1 })).expectedRevision).toBe(1);
    });
  });

  it('cada campo es opcional y normaliza como el alta', async () => {
    expect((await parse({ expectedRevision: 1, hourlyCost: '60' })).hourlyCost).toBe('60.00');
    expect((await parse({ expectedRevision: 1, currency: ' ars ' })).currency).toBe('ARS');
    expect((await parse({ expectedRevision: 1, active: false })).active).toBe(false);
    expect((await parse({ expectedRevision: 1, hourlyCost: '0' })).hourlyCost).toBe('0.00');
  });

  it.each([
    ['name', ['', '   ', null, 5, 'x'.repeat(151)], /nombre/i],
    ['hourlyCost', ['-1', '1.234', '10000000000', 50, null, ''], /costo por hora/i],
    ['currency', ['US', 'USDD', 5, null, ''], /moneda/i],
    ['active', ['true', 1, 'false', null, {}], /active/],
  ] as Array<[string, unknown[], RegExp]>)('%s: rechaza valores inválidos (y null, que NO es "sin cambio")', async (field, values, pattern) => {
    for (const value of values) expect(await messages({ expectedRevision: 1, [field]: value })).toMatch(pattern);
  });

  it('descarta lo que no es editable (id, revision, createdAt, updatedAt)', async () => {
    expect(defined(await parse({ expectedRevision: 2, name: 'x', id: 'x', revision: 99, createdAt: 'x', updatedAt: 'x' }))).toEqual(['expectedRevision', 'name']);
  });
});
