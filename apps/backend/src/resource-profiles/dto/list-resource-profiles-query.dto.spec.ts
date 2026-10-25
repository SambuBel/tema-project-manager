import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListResourceProfilesQueryDto } from './list-resource-profiles-query.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const parse = (query: Record<string, unknown>) => pipe.transform(query, { type: 'query', metatype: ListResourceProfilesQueryDto }) as Promise<ListResourceProfilesQueryDto>;

describe('ListResourceProfilesQueryDto', () => {
  it('includeInactive es opcional', async () => {
    expect((await parse({})).includeInactive).toBeUndefined();
  });
  it('acepta solo los textos "true" y "false"', async () => {
    expect((await parse({ includeInactive: 'true' })).includeInactive).toBe(true);
    expect((await parse({ includeInactive: 'false' })).includeInactive).toBe(false);
  });
  it.each(['1', '0', 'yes', 'TRUE', 'si', '', 'null'])('rechaza %j (no se interpretan strings arbitrarios)', async (value) => {
    await expect(parse({ includeInactive: value })).rejects.toBeInstanceOf(BadRequestException);
  });
});
