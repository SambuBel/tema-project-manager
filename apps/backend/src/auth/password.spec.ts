import { getDummyPasswordHash, hashPassword, normalizeEmail, verifyPassword } from './password';

describe('password (argon2id)', () => {
  it('hashea con argon2id, no guarda la contraseña en claro y verifica bien', async () => {
    const hash = await hashPassword('mi-clave-segura');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('mi-clave-segura');
    expect(await verifyPassword(hash, 'mi-clave-segura')).toBe(true);
    expect(await verifyPassword(hash, 'otra')).toBe(false);
  });

  it('dos hashes de la misma contraseña son distintos (salt)', async () => {
    expect(await hashPassword('igual')).not.toBe(await hashPassword('igual'));
  });

  it.each(['', 'basura', '$argon2id$roto', null as unknown as string])('verifyPassword con hash inválido (%p) devuelve false y no lanza', async (hash) => {
    await expect(verifyPassword(hash, 'x')).resolves.toBe(false);
  });

  it('el hash señuelo es un hash válido y se reutiliza (se calcula una sola vez)', async () => {
    const first = await getDummyPasswordHash();
    expect(first.startsWith('$argon2id$')).toBe(true);
    expect(await getDummyPasswordHash()).toBe(first);
    expect(await verifyPassword(first, 'otra-cosa')).toBe(false);
  });

  it('normalizeEmail: trim + minúsculas', () => {
    expect(normalizeEmail('  Ana@Tema.COM ')).toBe('ana@tema.com');
  });
});
