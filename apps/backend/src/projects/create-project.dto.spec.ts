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
