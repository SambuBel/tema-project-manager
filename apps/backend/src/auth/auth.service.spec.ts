import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { AUTH_ERROR_CODES, AuthError } from './auth.errors';
import { UserEntity } from '../database/entities/user.entity';
import { RoleEntity } from '../database/entities/role.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { ExternalAccountEntity } from '../database/entities/external-account.entity';
import { AuthorizedDomainEntity } from '../database/entities/authorized-domain.entity';
import { ExternalAccountProvider, RoleName } from '../database/enums';
import { GoogleProfileDto } from './dto/google-profile.dto';

/**
 * Mocks para Google: nunca se llama a la Google API real ni a passport en estos tests.
 * Se prueba directamente AuthService.loginWithGoogle con perfiles ya "normalizados"
 * (lo que produciria GoogleStrategy.validate).
 */
function makeGoogleProfile(overrides: Partial<GoogleProfileDto> = {}): GoogleProfileDto {
  return {
    providerSubject: 'google-sub-123',
    email: 'persona@empresa.com',
    emailVerified: true,
    name: 'Persona de Prueba',
    avatarUrl: 'https://example.com/avatar.png',
    ...overrides,
  };
}

type FakeWhere<T> = Partial<Record<keyof T, unknown>>;

function matchesWhere<T extends object>(row: T, where: FakeWhere<T>): boolean {
  return Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
}

/** Repo fake minimo, suficiente para lo que AuthService usa de cada Repository<T>. */
function createFakeRepo<T extends { id?: string }>(initialRows: T[] = []) {
  const rows = [...initialRows];
  return {
    rows,
    findOne: jest.fn(async ({ where }: { where: FakeWhere<T> }) => {
      return rows.find((row) => matchesWhere(row, where)) ?? null;
    }),
    findOneBy: jest.fn(async (where: FakeWhere<T>) => {
      return rows.find((row) => matchesWhere(row, where)) ?? null;
    }),
    create: jest.fn((data: Partial<T>) => ({ id: `generated-${rows.length + 1}`, ...data }) as T),
    save: jest.fn(async (entity: T) => {
      rows.push(entity);
      return entity;
    }),
    update: jest.fn(async (id: string, patch: Partial<T>) => {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    }),
  };
}

describe('AuthService', () => {
  let usersRepo: ReturnType<typeof createFakeRepo<UserEntity>>;
  let rolesRepo: ReturnType<typeof createFakeRepo<RoleEntity>>;
  let userRolesRepo: ReturnType<typeof createFakeRepo<UserRoleEntity>>;
  let externalAccountsRepo: ReturnType<typeof createFakeRepo<ExternalAccountEntity>>;
  let authorizedDomainsRepo: ReturnType<typeof createFakeRepo<AuthorizedDomainEntity>>;
  let authService: AuthService;

  beforeEach(() => {
    usersRepo = createFakeRepo<UserEntity>();
    rolesRepo = createFakeRepo<RoleEntity>([
      { id: 'role-collaborator', name: RoleName.COLLABORATOR } as RoleEntity,
    ]);
    userRolesRepo = createFakeRepo<UserRoleEntity>();
    externalAccountsRepo = createFakeRepo<ExternalAccountEntity>();
    authorizedDomainsRepo = createFakeRepo<AuthorizedDomainEntity>([
      { id: 'domain-1', domain: 'empresa.com', active: true } as AuthorizedDomainEntity,
    ]);

    const repoByEntity = new Map<unknown, unknown>([
      [UserEntity, usersRepo],
      [RoleEntity, rolesRepo],
      [UserRoleEntity, userRolesRepo],
      [ExternalAccountEntity, externalAccountsRepo],
      [AuthorizedDomainEntity, authorizedDomainsRepo],
    ]);

    const fakeManager = { getRepository: (entity: unknown) => repoByEntity.get(entity) };
    const dataSource = {
      transaction: jest.fn(async (fn: (manager: unknown) => unknown) => fn(fakeManager)),
      getRepository: (entity: unknown) => repoByEntity.get(entity),
    } as unknown as DataSource;

    const jwtService = { sign: jest.fn(() => 'signed.jwt.token') } as unknown as JwtService;
    const configService = {
      get: jest.fn((key: string) => (key === 'JWT_EXPIRES_IN' ? '8h' : undefined)),
    } as unknown as ConfigService;

    authService = new AuthService(
      dataSource,
      jwtService,
      configService,
      authorizedDomainsRepo as unknown as Repository<AuthorizedDomainEntity>,
      externalAccountsRepo as unknown as Repository<ExternalAccountEntity>,
    );
  });

  it('1) dominio autorizado + usuario inexistente -> crea User, ExternalAccount y asigna COLLABORATOR', async () => {
    const user = await authService.loginWithGoogle(makeGoogleProfile());

    expect(usersRepo.rows).toHaveLength(1);
    expect(usersRepo.rows[0]!.email).toBe('persona@empresa.com');
    expect(externalAccountsRepo.rows).toHaveLength(1);
    expect(externalAccountsRepo.rows[0]!.userId).toBe(user.id);
    expect(userRolesRepo.rows).toHaveLength(1);
    expect(userRolesRepo.rows[0]!.roleId).toBe('role-collaborator');
  });

  it('2) dominio autorizado + User existente sin cuenta Google -> vincula ExternalAccount, no duplica User', async () => {
    usersRepo.rows.push({
      id: 'user-existing',
      email: 'persona@empresa.com',
      name: 'Ya Existia',
      avatarUrl: null,
      active: true,
      deletedAt: null,
    } as UserEntity);

    const user = await authService.loginWithGoogle(makeGoogleProfile());

    expect(usersRepo.rows).toHaveLength(1);
    expect(user.id).toBe('user-existing');
    expect(externalAccountsRepo.rows).toHaveLength(1);
    expect(externalAccountsRepo.rows[0]!.userId).toBe('user-existing');
    expect(userRolesRepo.rows).toHaveLength(0); // no se re-asigna rol a un user ya existente
  });

  it('3) ExternalAccount ya existente -> recupera User, no duplica registros', async () => {
    const existingUser = {
      id: 'user-existing',
      email: 'persona@empresa.com',
      name: 'Ya Existia',
      avatarUrl: null,
      active: true,
      deletedAt: null,
    } as UserEntity;
    usersRepo.rows.push(existingUser);
    externalAccountsRepo.rows.push({
      id: 'ext-1',
      userId: existingUser.id,
      user: existingUser,
      provider: ExternalAccountProvider.GOOGLE,
      providerSubject: 'google-sub-123',
      email: 'persona@empresa.com',
      emailVerified: true,
    } as ExternalAccountEntity);

    const user = await authService.loginWithGoogle(makeGoogleProfile());

    expect(user.id).toBe('user-existing');
    expect(usersRepo.rows).toHaveLength(1);
    expect(externalAccountsRepo.rows).toHaveLength(1);
  });

  it('4) dominio no autorizado -> rechaza y no crea ningun registro', async () => {
    await expect(
      authService.loginWithGoogle(makeGoogleProfile({ email: 'persona@no-autorizado.com' })),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.UNAUTHORIZED_DOMAIN });

    expect(usersRepo.rows).toHaveLength(0);
    expect(externalAccountsRepo.rows).toHaveLength(0);
  });

  it('5) email_verified = false -> rechaza sin persistir nada', async () => {
    await expect(
      authService.loginWithGoogle(makeGoogleProfile({ emailVerified: false })),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED });

    expect(usersRepo.rows).toHaveLength(0);
    expect(externalAccountsRepo.rows).toHaveLength(0);
  });

  it('6) User existente con active=false -> rechaza y NO reactiva', async () => {
    usersRepo.rows.push({
      id: 'user-disabled',
      email: 'persona@empresa.com',
      name: 'Deshabilitado',
      avatarUrl: null,
      active: false,
      deletedAt: null,
    } as UserEntity);

    await expect(authService.loginWithGoogle(makeGoogleProfile())).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.USER_DISABLED,
    });

    expect(usersRepo.rows[0]!.active).toBe(false);
    expect(externalAccountsRepo.rows).toHaveLength(0);
  });

  it('7) rol COLLABORATOR inexistente -> falla controladamente, no crea User parcial', async () => {
    rolesRepo.rows.length = 0; // simula que el seed de roles nunca corrió

    await expect(authService.loginWithGoogle(makeGoogleProfile())).rejects.toThrow(
      /Rol por defecto/,
    );

    expect(usersRepo.rows).toHaveLength(0);
    expect(externalAccountsRepo.rows).toHaveLength(0);
    expect(userRolesRepo.rows).toHaveLength(0);
  });

  it('normaliza el dominio (mayúsculas/espacios) antes de comparar', () => {
    expect(AuthService.normalizeDomain('  Persona@EMPRESA.com  ')).toBe('empresa.com');
    expect(AuthService.normalizeDomain('sin-arroba')).toBe('');
  });

  it('AuthError no es una excepción HTTP de Nest: el controller decide el redirect', () => {
    const err = new AuthError(AUTH_ERROR_CODES.UNAUTHORIZED_DOMAIN);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('UNAUTHORIZED_DOMAIN');
  });
});
