import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

const run = async (payload: Record<string, unknown>) => {
  const dto = plainToInstance(LoginDto, payload);
  return { dto, fields: (await validate(dto)).map((e) => e.property) };
};

describe('LoginDto', () => {
  it('acepta email + contraseña y normaliza el email (trim + minúsculas); la contraseña NO se toca', async () => {
    const { dto, fields } = await run({ email: '  Persona@TEMA.com ', password: '  Con Espacios  ' });
    expect(fields).toEqual([]);
    expect(dto.email).toBe('persona@tema.com');
    expect(dto.password).toBe('  Con Espacios  ');
  });

  it.each([{}, { email: 'a@b.com' }, { password: 'x' }, { email: '', password: 'x' }, { email: 'a@b.com', password: '' }, { email: 1, password: 2 }])(
    'rechaza %j',
    async (payload) => {
      expect((await run(payload)).fields.length).toBeGreaterThan(0);
    },
  );

  it('un email con formato inválido NO da 400 (para no distinguirlo de un email inexistente): llega al login y falla como 401', async () => {
    expect((await run({ email: 'no-es-email', password: 'x' })).fields).toEqual([]);
  });

  it('tope de largo: evita forzar a argon2 a hashear textos enormes', async () => {
    expect((await run({ email: 'a@b.com', password: 'x'.repeat(257) })).fields).toContain('password');
    expect((await run({ email: 'a'.repeat(256), password: 'x' })).fields).toContain('email');
  });
});
