import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateBudgetVersionDto } from './create-budget-version.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const parse = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: CreateBudgetVersionDto }) as Promise<CreateBudgetVersionDto>;
const valid = { expectedVersion: 1, totalAmount: '1200000.5', currency: ' usd ', approvalDate: '2026-11-01' };
const messages = async (body: Record<string, unknown>): Promise<string> => {
  try {
    await parse(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string[] }).message.join(' | ');
  }
  throw new Error('Se esperaba un 400');
};

describe('CreateBudgetVersionDto', () => {
  it('acepta y normaliza con las mismas reglas que el alta inicial', async () => {
    expect(await parse(valid)).toMatchObject({ expectedVersion: 1, totalAmount: '1200000.50', currency: 'USD', approvalDate: '2026-11-01' });
  });

  it('expectedVersion es OBLIGATORIO', async () => {
    const { expectedVersion: _omit, ...rest } = valid;
    void _omit;
    expect(await messages(rest)).toMatch(/expectedVersion/);
  });

  it.each([0, -1, 1.5, '1', null, true, NaN])('rechaza expectedVersion = %j', async (value) => {
    expect(await messages({ ...valid, expectedVersion: value })).toMatch(/expectedVersion/);
  });

  it('hereda las validaciones: importe número, moneda y fecha inválidas', async () => {
    expect(await messages({ ...valid, totalAmount: 10 })).toMatch(/importe/i);
    expect(await messages({ ...valid, currency: 'US' })).toMatch(/moneda/i);
    expect(await messages({ ...valid, approvalDate: '2026-02-31' })).toMatch(/fecha/i);
  });

  it('descarta campos que decide el servidor', async () => {
    const parsed = await parse({ ...valid, version: 9, isCurrent: false, createdBy: 'x' });
    expect(parsed).not.toHaveProperty('version');
    expect(parsed).not.toHaveProperty('isCurrent');
    expect(parsed).not.toHaveProperty('createdBy');
  });
});
