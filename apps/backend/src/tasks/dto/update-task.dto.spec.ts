import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTaskDto } from './update-task.dto';

async function check(payload: Record<string, unknown>) {
  const errors = await validate(plainToInstance(UpdateTaskDto, payload));
  return errors.map((e) => e.property);
}

describe('UpdateTaskDto - formato de fechas', () => {
  it('acepta un update sin fechas', async () => {
    expect(await check({ title: 'x' })).toHaveLength(0);
  });

  it('acepta fechas válidas', async () => {
    expect(await check({ startDate: '2026-10-10', dueDate: '2026-10-20' })).toHaveLength(0);
  });

  it('acepta null para limpiar una fecha', async () => {
    expect(await check({ startDate: null, dueDate: null })).toHaveLength(0);
  });

  it.each(['mañana', '2026-02-31', '10/10/2026', '', 20261010])('rechaza startDate %p', async (startDate) => {
    expect(await check({ startDate })).toContain('startDate');
  });

  it.each(['mañana', '2026-13-01', '30-10-2026', '', 20261030])('rechaza dueDate %p', async (dueDate) => {
    expect(await check({ dueDate })).toContain('dueDate');
  });
});
