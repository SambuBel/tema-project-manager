import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

const check = async (payload: Record<string, unknown>) =>
  (await validate(plainToInstance(CreateProjectDto, payload))).map((e) => e.property);

describe('CreateProjectDto - leaderId', () => {
  it('es opcional', async () => {
    expect(await check({ name: 'P' })).toHaveLength(0);
  });

  it('acepta un UUID', async () => {
    expect(await check({ name: 'P', leaderId: '11111111-1111-4111-8111-111111111111' })).toHaveLength(0);
  });

  it.each(['no-uuid', '123', '', 42])('rechaza %p', async (leaderId) => {
    expect(await check({ name: 'P', leaderId })).toContain('leaderId');
  });
});

describe('CreateProjectDto - fechas de inicio y entrega', () => {
  it('acepta entrega igual o posterior al inicio', async () => {
    expect(await check({ name: 'P', startDate: '2026-10-01', estimatedEndDate: '2026-10-01' })).toHaveLength(0);
    expect(await check({ name: 'P', startDate: '2026-10-01', estimatedEndDate: '2026-10-31' })).toHaveLength(0);
  });

  it('rechaza entrega anterior al inicio', async () => {
    const errors = await check({ name: 'P', startDate: '2026-10-31', estimatedEndDate: '2026-10-01' });
    expect(errors).toContain('estimatedEndDate');
  });

  it('acepta solo una de las dos fechas', async () => {
    expect(await check({ name: 'P', startDate: '2026-10-01' })).toHaveLength(0);
    expect(await check({ name: 'P', estimatedEndDate: '2026-10-31' })).toHaveLength(0);
  });
});
