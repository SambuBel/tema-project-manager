import { ValidationPipe } from '@nestjs/common';
import { ListUsersQueryDto } from './list-users-query.dto';

const parse = (query: Record<string, unknown>) =>
  new ValidationPipe({ whitelist: true, transform: true }).transform(query, { type: 'query', metatype: ListUsersQueryDto }) as Promise<ListUsersQueryDto>;

describe('ListUsersQueryDto.includeInactive', () => {
  it('sin el parámetro queda undefined (comportamiento de siempre)', async () => {
    expect((await parse({})).includeInactive).toBeUndefined();
  });

  it.each([
    ['true', true],
    ['false', false],
    ['cualquier-otra-cosa', false],
  ])('?includeInactive=%s → %s', async (raw, expected) => {
    expect((await parse({ includeInactive: raw })).includeInactive).toBe(expected);
  });

  it('se combina con search y role sin pisarlos', async () => {
    expect(await parse({ includeInactive: 'true', search: 'ana', role: 'ADMIN' })).toMatchObject({ includeInactive: true, search: 'ana', role: 'ADMIN' });
  });
});
