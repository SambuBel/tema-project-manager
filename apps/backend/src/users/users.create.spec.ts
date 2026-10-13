import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CreateUserDto } from './dto/create-user.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { verifyPassword } from '../auth/password';
import { RoleEntity } from '../database/entities/role.entity';
import { UserEntity } from '../database/entities/user.entity';
import { RoleName } from '../database/enums';

interface SavedUser {
  id: string;
  email: string;
  name: string;
  active: boolean;
  passwordHash: string | null;
}

function build(opts: { existingEmails?: string[]; missingRoles?: RoleName[] } = {}) {
  const savedUsers: SavedUser[] = [];
  const savedUserRoles: Array<{ userId: string; roleId: string }> = [];

  const usersRepoTx = {
    create: jest.fn((data: Partial<SavedUser>) => ({ id: 'new-user', ...data })),
    save: jest.fn(async (u: SavedUser) => {
      savedUsers.push(u);
      return u;
    }),
  };
  const rolesRepoTx = {
    findOneBy: jest.fn(async ({ name }: { name: RoleName }) => (opts.missingRoles?.includes(name) ? null : { id: `role-${name}`, name })),
  };
  const userRolesRepoTx = {
    create: jest.fn((data: { userId: string; roleId: string }) => data),
    save: jest.fn(async (rows: Array<{ userId: string; roleId: string }>) => {
      savedUserRoles.push(...rows);
      return rows;
    }),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => (entity === UserEntity ? usersRepoTx : entity === RoleEntity ? rolesRepoTx : userRolesRepoTx)),
  };
  const dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)) };

  const emailQb: { withDeleted: jest.Mock; where: jest.Mock; getOne: jest.Mock; lookedUp: string } = {
    withDeleted: jest.fn(),
    where: jest.fn(),
    lookedUp: '',
    getOne: jest.fn(async () => (opts.existingEmails?.includes(emailQb.lookedUp) ? { id: 'ya-existe' } : null)),
  };
  emailQb.withDeleted.mockReturnValue(emailQb);
  emailQb.where.mockImplementation((_sql: string, p: { email: string }) => {
    emailQb.lookedUp = p.email;
    return emailQb;
  });
  const usersRepo = {
    createQueryBuilder: jest.fn(() => emailQb),
    // lectura posterior (select:false → sin hash), como en el repositorio real
    findOneBy: jest.fn(async ({ id }: { id: string }) => {
      const u = savedUsers.find((s) => s.id === id);
      return u ? { id: u.id, email: u.email, name: u.name, active: u.active } : null;
    }),
  };
  const userRolesRepo = {
    createQueryBuilder: jest.fn(() => ({
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(async () => savedUserRoles.map((r) => ({ name: r.roleId.replace('role-', '') }))),
    })),
  };

  const service = new UsersService(usersRepo as never, {} as never, userRolesRepo as never, {} as never, dataSource as never);
  return { service, savedUsers, savedUserRoles, dataSource };
}

const dto = (overrides: Partial<CreateUserDto> = {}): CreateUserDto => ({
  email: 'nuevo@tema.com',
  name: 'Nuevo Usuario',
  password: 'clave-inicial-1',
  ...overrides,
});

describe('UsersService.createUser (alta administrativa)', () => {
  it('crea el usuario con la contraseña HASHEADA (argon2id), nunca en claro', async () => {
    const { service, savedUsers } = build();
    await service.createUser(dto());

    expect(savedUsers).toHaveLength(1);
    const hash = savedUsers[0]!.passwordHash!;
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('clave-inicial-1');
    expect(await verifyPassword(hash, 'clave-inicial-1')).toBe(true);
  });

  it('NUNCA devuelve passwordHash (ni la contraseña) en la respuesta', async () => {
    const { service } = build();
    const result = await service.createUser(dto());
    expect(result).toMatchObject({ email: 'nuevo@tema.com', name: 'Nuevo Usuario', roles: [RoleName.COLLABORATOR] });
    expect(JSON.stringify(result)).not.toMatch(/password|hash|argon2|clave-inicial/i);
  });

  it('guarda el email normalizado (minúsculas) aunque el service reciba otro formato', async () => {
    const { service, savedUsers } = build();
    await service.createUser(dto({ email: '  Nuevo@TEMA.com ' }));
    expect(savedUsers[0]!.email).toBe('nuevo@tema.com');
  });

  it('sin roles explícitos: queda como COLLABORATOR', async () => {
    const { service, savedUserRoles } = build();
    await service.createUser(dto());
    expect(savedUserRoles).toEqual([{ userId: 'new-user', roleId: `role-${RoleName.COLLABORATOR}` }]);
  });

  it('con roles explícitos (multi-rol): asigna exactamente esos', async () => {
    const { service, savedUserRoles } = build();
    await service.createUser(dto({ roles: [RoleName.ADMIN, RoleName.PROJECT_LEADER] }));
    expect(savedUserRoles.map((r) => r.roleId)).toEqual([`role-${RoleName.ADMIN}`, `role-${RoleName.PROJECT_LEADER}`]);
  });

  it('email repetido (sin distinguir mayúsculas, incluso de un usuario dado de baja): 409 y no escribe nada', async () => {
    const { service, savedUsers, dataSource } = build({ existingEmails: ['nuevo@tema.com'] });
    await expect(service.createUser(dto())).rejects.toBeInstanceOf(ConflictException);
    expect(savedUsers).toHaveLength(0);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rol inexistente en el catálogo: 400 y no se crea el usuario (la transacción aborta antes de guardar)', async () => {
    const { service, savedUsers } = build({ missingRoles: [RoleName.OBSERVER] });
    await expect(service.createUser(dto({ roles: [RoleName.OBSERVER] }))).rejects.toBeInstanceOf(BadRequestException);
    expect(savedUsers).toHaveLength(0);
  });
});

describe('POST /users: solo ADMIN', () => {
  it('el endpoint exige el rol ADMIN (RolesGuard + @Roles) además de la sesión', () => {
    expect(Reflect.getMetadata(ROLES_KEY, UsersController.prototype.create)).toEqual([RoleName.ADMIN]);
    expect(Reflect.getMetadata('__guards__', UsersController.prototype.create)).toContain(RolesGuard);
  });

  it.each([RoleName.PROGRAM_MANAGER, RoleName.PROJECT_LEADER, RoleName.COLLABORATOR, RoleName.OBSERVER])(
    'RolesGuard deja afuera a %s (403) y deja pasar a ADMIN',
    (role) => {
      const reflector = { getAllAndOverride: jest.fn(() => [RoleName.ADMIN]) };
      const guard = new RolesGuard(reflector as never);
      const ctx = (roles: RoleName[]) =>
        ({ getHandler: jest.fn(), getClass: jest.fn(), switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }) }) as never;

      expect(() => guard.canActivate(ctx([role]))).toThrow('No tenés permisos');
      expect(guard.canActivate(ctx([RoleName.ADMIN]))).toBe(true);
      expect(guard.canActivate(ctx([role, RoleName.ADMIN]))).toBe(true); // multi-rol
    },
  );
});

describe('CreateUserDto', () => {
  const run = async (payload: Record<string, unknown>) => {
    const instance = plainToInstance(CreateUserDto, payload);
    return { instance, fields: (await validate(instance)).map((e) => e.property) };
  };

  it('acepta un alta mínima y normaliza email (minúsculas) y nombre (trim)', async () => {
    const { instance, fields } = await run({ email: '  Nuevo@TEMA.com ', name: '  Ana  ', password: '12345678' });
    expect(fields).toEqual([]);
    expect(instance.email).toBe('nuevo@tema.com');
    expect(instance.name).toBe('Ana');
  });

  it.each([
    [{ email: 'no-es-email', name: 'A', password: '12345678' }, 'email'],
    [{ email: 'a@b.com', name: '   ', password: '12345678' }, 'name'],
    [{ email: 'a@b.com', name: 'A', password: '1234567' }, 'password'], // < 8
    [{ email: 'a@b.com', name: 'A', password: 'x'.repeat(129) }, 'password'],
    [{ email: 'a@b.com', name: 'A', password: '12345678', roles: ['SUPERUSER'] }, 'roles'],
    [{ email: 'a@b.com', name: 'A', password: '12345678', roles: ['ADMIN', 'ADMIN'] }, 'roles'],
  ])('rechaza %j (campo %s)', async (payload, field) => {
    expect((await run(payload)).fields).toContain(field);
  });

  it('un passwordHash enviado por el cliente se DESCARTA (ValidationPipe con whitelist, el de main.ts): solo se acepta `password`', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = (await pipe.transform(
      { email: 'a@b.com', name: 'A', password: '12345678', passwordHash: '$argon2id$inyectado', active: false },
      { type: 'body', metatype: CreateUserDto },
    )) as Record<string, unknown>;

    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('active');
    expect(result).toMatchObject({ email: 'a@b.com', password: '12345678' });
  });
});
