import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AUTH_ERROR_CODES, AuthError } from './auth.errors';
import { hashPassword } from './password';
import { UserEntity } from '../database/entities/user.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { ExternalAccountEntity } from '../database/entities/external-account.entity';
import { ExternalAccountProvider } from '../database/enums';
import { GoogleProfileDto } from './dto/google-profile.dto';

/**
 * Login = AUTENTICAR, nunca PROVISIONAR. El fake de DataSource registra TODA escritura (save, create,
 * insert, update, delete) de CUALQUIER repositorio —también las hechas dentro de dataSource.transaction—
 * en un único registro, para poder afirmar exactamente qué tablas se tocaron (o que no se tocó ninguna).
 */
interface UserRow {
  id: string;
  email: string;
  active: boolean;
  deletedAt: Date | null;
  passwordHash: string | null;
  createdAt: Date;
}
interface AccountRow {
  id: string;
  userId: string;
  provider: ExternalAccountProvider;
  providerSubject: string;
  email: string;
  emailVerified: boolean;
  user?: UserRow;
}

const WRITE_METHODS = ['save', 'create', 'insert', 'update', 'delete', 'remove', 'upsert'] as const;

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'u1',
    email: 'persona@tema.com',
    active: true,
    deletedAt: null,
    passwordHash: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeProfile(overrides: Partial<GoogleProfileDto> = {}): GoogleProfileDto {
  return { providerSubject: 'google-sub-1', email: 'persona@tema.com', emailVerified: true, name: 'Persona', avatarUrl: null, ...overrides };
}

function build(opts: { users?: UserRow[]; accounts?: AccountRow[]; authorizedDomains?: string[] } = {}) {
  const users = opts.users ?? [];
  const accounts = opts.accounts ?? [];
  /** Cada escritura: "Entidad.metodo". */
  const writes: string[] = [];

  const track = (entityName: string, repo: Record<string, unknown>) => {
    for (const method of WRITE_METHODS) {
      repo[method] = jest.fn(async (...args: unknown[]) => {
        writes.push(`${entityName}.${method}`);
        return args[0];
      });
    }
    return repo;
  };

  const usersRepo = track('UserEntity', {
    findOneBy: jest.fn(async ({ id }: { id: string }) => users.find((u) => u.id === id && !u.deletedAt) ?? null),
    createQueryBuilder: jest.fn(() => {
      let email = '';
      let withPassword = false;
      const qb: Record<string, jest.Mock> = {};
      qb.withDeleted = jest.fn(() => qb);
      qb.where = jest.fn((_sql: string, params: { email: string }) => {
        email = params.email;
        return qb;
      });
      qb.orderBy = jest.fn(() => qb);
      qb.addSelect = jest.fn(() => {
        withPassword = true;
        return qb;
      });
      qb.getOne = jest.fn(async () => {
        const found = users.find((u) => u.email.toLowerCase() === email) ?? null;
        // select: false → sin addSelect el hash NO viene
        return found ? { ...found, passwordHash: withPassword ? found.passwordHash : undefined } : null;
      });
      return qb;
    }),
  });

  const accountsRepo = track('ExternalAccountEntity', {
    findOne: jest.fn(async ({ where }: { where: { providerSubject: string } }) => {
      const acc = accounts.find((a) => a.providerSubject === where.providerSubject);
      return acc ? { ...acc, user: users.find((u) => u.id === acc.userId && !u.deletedAt) } : null;
    }),
    create: jest.fn((data: Partial<AccountRow>) => {
      writes.push('ExternalAccountEntity.create');
      return { id: 'acc-new', ...data };
    }),
  });

  const domainsRepo = {
    findOne: jest.fn(async ({ where }: { where: { domain: string } }) =>
      (opts.authorizedDomains ?? ['tema.com']).includes(where.domain) ? { domain: where.domain, active: true } : null,
    ),
  };

  const repoFor = (entity: unknown) => {
    if (entity === UserEntity) return usersRepo;
    if (entity === ExternalAccountEntity) return accountsRepo;
    // Cualquier otra tabla (user_roles, roles...): se anota cualquier escritura.
    const name = (entity as { name?: string }).name ?? 'Otra';
    return track(name, { createQueryBuilder: jest.fn() });
  };
  const manager = { getRepository: jest.fn(repoFor) };
  const dataSource = {
    getRepository: jest.fn(repoFor),
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };

  const service = new AuthService(
    dataSource as never,
    new JwtService({ secret: 'test-secret-1234567890' }),
    new ConfigService({}),
    domainsRepo as never,
    accountsRepo as never,
  );
  return { service, writes, users, accounts, usersRepo };
}

let CORRECT_HASH: string;
beforeAll(async () => {
  CORRECT_HASH = await hashPassword('correcta-123');
});

describe('AuthService.loginWithPassword', () => {
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      return (error as AuthError).code;
    }
    throw new Error('Se esperaba un AuthError');
  };

  it('usuario existente + activo + contraseña correcta → OK, y no escribe nada', async () => {
    const { service, writes } = build({ users: [makeUser({ passwordHash: CORRECT_HASH })] });
    const user = await service.loginWithPassword('persona@tema.com', 'correcta-123');
    expect(user.id).toBe('u1');
    expect(writes).toEqual([]);
  });

  it('el hash no sale del método (passwordHash null en el resultado)', async () => {
    const { service } = build({ users: [makeUser({ passwordHash: CORRECT_HASH })] });
    expect((await service.loginWithPassword('persona@tema.com', 'correcta-123')).passwordHash).toBeNull();
  });

  it('el email se compara sin distinguir mayúsculas ni espacios (ej. "leaderA@test" guardado con mayúscula)', async () => {
    const { service } = build({ users: [makeUser({ email: 'LeaderA@Tema.com', passwordHash: CORRECT_HASH })] });
    await expect(service.loginWithPassword('  leadera@TEMA.com ', 'correcta-123')).resolves.toMatchObject({ id: 'u1' });
  });

  it('email inexistente → INVALID_CREDENTIALS y NO se crea ningún usuario ni nada', async () => {
    const { service, writes, users } = build({ users: [makeUser({ passwordHash: CORRECT_HASH })] });
    expect(await codeOf(service.loginWithPassword('nadie@tema.com', 'cualquiera'))).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
    expect(users).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  it('contraseña incorrecta → INVALID_CREDENTIALS', async () => {
    const { service } = build({ users: [makeUser({ passwordHash: CORRECT_HASH })] });
    expect(await codeOf(service.loginWithPassword('persona@tema.com', 'incorrecta'))).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
  });

  it('email inexistente y contraseña incorrecta dan EXACTAMENTE el mismo error (sin user enumeration)', async () => {
    const { service } = build({ users: [makeUser({ passwordHash: CORRECT_HASH })] });
    const missing = await service.loginWithPassword('nadie@tema.com', 'x').catch((e: AuthError) => e);
    const wrong = await service.loginWithPassword('persona@tema.com', 'x').catch((e: AuthError) => e);
    expect([(missing as AuthError).code, (missing as AuthError).message]).toEqual([(wrong as AuthError).code, (wrong as AuthError).message]);
  });

  it('usuario de solo Google (passwordHash = null) → INVALID_CREDENTIALS, igual que si no existiera; no se genera contraseña', async () => {
    const { service, writes } = build({ users: [makeUser({ passwordHash: null })] });
    expect(await codeOf(service.loginWithPassword('persona@tema.com', 'lo-que-sea'))).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
    expect(writes).toEqual([]);
  });

  it('hash corrupto en la base → INVALID_CREDENTIALS (no explota)', async () => {
    const { service } = build({ users: [makeUser({ passwordHash: 'esto-no-es-un-hash-argon2' })] });
    expect(await codeOf(service.loginWithPassword('persona@tema.com', 'x'))).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
  });

  it('usuario inactivo + contraseña correcta → USER_DISABLED', async () => {
    const { service } = build({ users: [makeUser({ active: false, passwordHash: CORRECT_HASH })] });
    expect(await codeOf(service.loginWithPassword('persona@tema.com', 'correcta-123'))).toBe(AUTH_ERROR_CODES.USER_DISABLED);
  });

  it('usuario con baja lógica (deletedAt; así queda un usuario desactivado) + contraseña correcta → USER_DISABLED, no "no existe"', async () => {
    const { service } = build({ users: [makeUser({ active: false, deletedAt: new Date(), passwordHash: CORRECT_HASH })] });
    expect(await codeOf(service.loginWithPassword('persona@tema.com', 'correcta-123'))).toBe(AUTH_ERROR_CODES.USER_DISABLED);
  });

  it('usuario inactivo + contraseña INCORRECTA → INVALID_CREDENTIALS (no se revela que la cuenta existe ni que está deshabilitada)', async () => {
    const { service } = build({ users: [makeUser({ active: false, deletedAt: new Date(), passwordHash: CORRECT_HASH })] });
    expect(await codeOf(service.loginWithPassword('persona@tema.com', 'incorrecta'))).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
  });

  it('pide explícitamente la columna del hash (select: false) y busca incluyendo bajas lógicas', async () => {
    const { service, usersRepo } = build({ users: [makeUser({ passwordHash: CORRECT_HASH })] });
    await service.loginWithPassword('persona@tema.com', 'correcta-123');
    const qb = (usersRepo.createQueryBuilder as jest.Mock).mock.results[0]!.value as Record<string, jest.Mock>;
    expect(qb.addSelect).toHaveBeenCalledWith('user.passwordHash');
    expect(qb.withDeleted).toHaveBeenCalled();
  });
});

describe('AuthService.loginWithGoogle - autentica, NO provisiona', () => {
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return (error as AuthError).code;
    }
    throw new Error('Se esperaba un AuthError');
  };

  it('email existente + activo (primera vez con Google) → OK y SOLO se vincula la cuenta de Google', async () => {
    const { service, writes } = build({ users: [makeUser()] });
    await expect(service.loginWithGoogle(makeProfile())).resolves.toMatchObject({ id: 'u1' });
    expect(writes).toEqual(['ExternalAccountEntity.create', 'ExternalAccountEntity.save']);
  });

  it('cuenta de Google ya vinculada → OK sin crear nada', async () => {
    const account: AccountRow = { id: 'a1', userId: 'u1', provider: ExternalAccountProvider.GOOGLE, providerSubject: 'google-sub-1', email: 'persona@tema.com', emailVerified: true };
    const { service, writes } = build({ users: [makeUser()], accounts: [account] });
    await expect(service.loginWithGoogle(makeProfile())).resolves.toMatchObject({ id: 'u1' });
    expect(writes).toEqual([]);
  });

  it('email INEXISTENTE → USER_NOT_REGISTERED y NO se persiste NADA (ni users, ni user_roles, ni external_accounts)', async () => {
    const { service, writes, users, accounts } = build({ users: [makeUser()] });
    expect(await codeOf(service.loginWithGoogle(makeProfile({ email: 'desconocido@tema.com', providerSubject: 'otro-sub' })))).toBe(
      AUTH_ERROR_CODES.USER_NOT_REGISTERED,
    );
    expect(writes).toEqual([]);
    expect(users).toHaveLength(1);
    expect(accounts).toHaveLength(0);
  });

  it('REGRESIÓN (auto-provisioning): email de DOMINIO AUTORIZADO pero sin usuario → rechazado y cero escrituras en cualquier tabla', async () => {
    const { service, writes, users, accounts } = build({ users: [makeUser()], authorizedDomains: ['tema.com'] });
    const usersBefore = users.length;

    const code = await codeOf(service.loginWithGoogle(makeProfile({ email: 'random-user@tema.com', providerSubject: 'random-sub' })));

    expect(code).toBe(AUTH_ERROR_CODES.USER_NOT_REGISTERED);
    expect(users).toHaveLength(usersBefore); // users sin cambios
    expect(accounts).toHaveLength(0); // external_accounts sin registro para ese email
    expect(writes.filter((w) => w.startsWith('UserEntity') || w.startsWith('UserRoleEntity') || w.startsWith('RoleEntity'))).toEqual([]);
    expect(writes).toEqual([]); // ninguna escritura, ni siquiera dentro de una transacción
  });

  it('REGRESIÓN: nunca asigna roles (ni COLLABORATOR) ni toca user_roles, ni siquiera para un usuario existente', async () => {
    const { service, writes } = build({ users: [makeUser()] });
    await service.loginWithGoogle(makeProfile());
    expect(writes.some((w) => w.startsWith(UserRoleEntity.name))).toBe(false);
    expect(writes.some((w) => w.startsWith('UserEntity'))).toBe(false);
  });

  it('dominio NO autorizado → UNAUTHORIZED_DOMAIN, sin escribir', async () => {
    const { service, writes } = build({ users: [makeUser({ email: 'persona@otra.com' })] });
    expect(await codeOf(service.loginWithGoogle(makeProfile({ email: 'persona@otra.com' })))).toBe(AUTH_ERROR_CODES.UNAUTHORIZED_DOMAIN);
    expect(writes).toEqual([]);
  });

  it('email_verified = false → rechazado sin persistir', async () => {
    const { service, writes } = build({ users: [makeUser()] });
    expect(await codeOf(service.loginWithGoogle(makeProfile({ emailVerified: false })))).toBe(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
    expect(writes).toEqual([]);
  });

  it('usuario inactivo → USER_DISABLED, no se reactiva ni se vincula la cuenta', async () => {
    const { service, writes } = build({ users: [makeUser({ active: false, deletedAt: new Date() })] });
    expect(await codeOf(service.loginWithGoogle(makeProfile()))).toBe(AUTH_ERROR_CODES.USER_DISABLED);
    expect(writes).toEqual([]);
  });

  it('cuenta de Google vinculada a un usuario desactivado → USER_DISABLED', async () => {
    const account: AccountRow = { id: 'a1', userId: 'u1', provider: ExternalAccountProvider.GOOGLE, providerSubject: 'google-sub-1', email: 'persona@tema.com', emailVerified: true };
    const { service, writes } = build({ users: [makeUser({ active: false, deletedAt: new Date() })], accounts: [account] });
    expect(await codeOf(service.loginWithGoogle(makeProfile()))).toBe(AUTH_ERROR_CODES.USER_DISABLED);
    expect(writes).toEqual([]);
  });

  it('el email de Google se compara sin distinguir mayúsculas', async () => {
    const { service } = build({ users: [makeUser({ email: 'Persona@Tema.com' })] });
    await expect(service.loginWithGoogle(makeProfile({ email: 'persona@tema.com' }))).resolves.toMatchObject({ id: 'u1' });
  });

  it('un usuario con contraseña también puede entrar por Google (y viceversa): ambos métodos son independientes', async () => {
    const { service } = build({ users: [makeUser({ passwordHash: CORRECT_HASH })] });
    await expect(service.loginWithGoogle(makeProfile())).resolves.toMatchObject({ id: 'u1' });
    await expect(service.loginWithPassword('persona@tema.com', 'correcta-123')).resolves.toMatchObject({ id: 'u1' });
  });
});

describe('AuthService - utilidades', () => {
  it('normaliza el dominio (mayúsculas/espacios) antes de comparar', () => {
    expect(AuthService.normalizeDomain('  Persona@EMPRESA.com ')).toBe('empresa.com');
    expect(AuthService.normalizeDomain('sin-arroba')).toBe('');
  });

  it('AuthError no es una excepción HTTP de Nest: el controller decide el redirect / la respuesta', () => {
    const error = new AuthError(AUTH_ERROR_CODES.USER_NOT_REGISTERED);
    expect(error.name).toBe('AuthError');
    expect(error.code).toBe('USER_NOT_REGISTERED');
  });
});
