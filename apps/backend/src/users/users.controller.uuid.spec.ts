import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsService } from '../auth/permissions.service';
import { RoleName } from '../database/enums';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Un id que no es UUID debe responder 400 y NO llegar al service: antes llegaba a PostgreSQL, que rechazaba el texto
 * ("invalid input syntax for type uuid") y terminaba en un 500. Se levanta el controller con Nest (guards y services
 * simulados) para ejercitar la pipe de verdad; llamar al método directo no la ejecuta.
 */
describe('UsersController - :id debe ser un UUID', () => {
  const VALID_ID = '6a1d5110-5a2b-4c3d-8e4f-0123456789ab';
  const INVALID_ID = '6a1d5110-dasdasd';

  let app: INestApplication;
  let baseUrl: string;
  let usersService: { findOneWithRoles: jest.Mock; setActive: jest.Mock; assignRole: jest.Mock; removeRole: jest.Mock };

  beforeAll(async () => {
    usersService = {
      findOneWithRoles: jest.fn(async () => ({ id: VALID_ID })),
      setActive: jest.fn(async () => ({ id: VALID_ID })),
      assignRole: jest.fn(async () => ({ id: VALID_ID })),
      removeRole: jest.fn(async () => ({ id: VALID_ID })),
    };
    const fakeAuth = {
      canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
        context.switchToHttp().getRequest().user = { id: 'admin-1', roles: [RoleName.ADMIN] };
        return true;
      },
    };

    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: PermissionsService, useValue: { canViewUsers: () => true } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeAuth)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); // igual que main.ts
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it.each([
    ['GET /users/:id', 'GET', (id: string) => `/users/${id}`, undefined, 'findOneWithRoles'],
    ['PATCH /users/:id/status', 'PATCH', (id: string) => `/users/${id}/status`, { active: false }, 'setActive'],
    ['POST /users/:id/roles', 'POST', (id: string) => `/users/${id}/roles`, { role: 'OBSERVER' }, 'assignRole'],
    ['DELETE /users/:id/roles/:role', 'DELETE', (id: string) => `/users/${id}/roles/OBSERVER`, undefined, 'removeRole'],
  ] as const)('%s: un id inválido responde 400 y no llega al service', async (_label, method, path, body, serviceMethod) => {
    const res = await call(method, path(INVALID_ID), body);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: 'Validation failed (uuid is expected)', statusCode: 400 });
    expect(usersService[serviceMethod]).not.toHaveBeenCalled();
  });

  it.each([
    ['GET /users/:id', 'GET', (id: string) => `/users/${id}`, undefined, 'findOneWithRoles'],
    ['PATCH /users/:id/status', 'PATCH', (id: string) => `/users/${id}/status`, { active: false }, 'setActive'],
    ['POST /users/:id/roles', 'POST', (id: string) => `/users/${id}/roles`, { role: 'OBSERVER' }, 'assignRole'],
    ['DELETE /users/:id/roles/:role', 'DELETE', (id: string) => `/users/${id}/roles/OBSERVER`, undefined, 'removeRole'],
  ] as const)('%s: un UUID válido sigue llegando al service', async (_label, method, path, body, serviceMethod) => {
    const res = await call(method, path(VALID_ID), body);

    expect(res.status).toBeLessThan(300);
    expect(usersService[serviceMethod]).toHaveBeenCalledTimes(1);
    expect(usersService[serviceMethod].mock.calls[0]![0]).toBe(VALID_ID);
  });
});
