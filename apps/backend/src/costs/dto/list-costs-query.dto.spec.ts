import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListCostsQueryDto } from './list-costs-query.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const parse = (query: Record<string, unknown>) => pipe.transform(query, { type: 'query', metatype: ListCostsQueryDto }) as Promise<ListCostsQueryDto>;

describe('ListCostsQueryDto', () => {
  it('page y limit son opcionales y se convierten a número', async () => {
    expect(await parse({})).toEqual({});
    expect(await parse({ page: '2', limit: '25' })).toEqual({ page: 2, limit: 25 });
  });
  it.each([{ page: '0' }, { page: '-1' }, { page: 'x' }, { limit: '0' }, { limit: '101' }, { limit: '1.5' }])('rechaza %j', async (query) => {
    await expect(parse(query)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('acepta el máximo (100)', async () => {
    expect((await parse({ limit: '100' })).limit).toBe(100);
  });
});
