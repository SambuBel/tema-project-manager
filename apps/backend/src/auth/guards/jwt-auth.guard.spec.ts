import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../../users/users.service';
import { UserEntity } from '../../database/entities/user.entity';
import { AuthService } from '../auth.service';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function makeUsersService(user: Partial<UserEntity> | null): UsersService {
  return { findById: jest.fn(async () => user) } as unknown as UsersService;
}

/** Por defecto sin roles: alcanza para los tests que no le importa el valor. */
function makeAuthService(roles: string[] = []): AuthService {
  return { getRoleNames: jest.fn(async () => roles) } as unknown as AuthService;
}

describe('JwtAuthGuard', () => {
  it('8) sin cookie de sesión -> 401', async () => {
    const jwtService = { verify: jest.fn() } as unknown as JwtService;
    const guard = new JwtAuthGuard(jwtService, makeUsersService(null), makeAuthService());
    const context = makeContext({ cookies: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('JWT invalido/expirado -> 401', async () => {
    const jwtService = {
      verify: jest.fn(() => {
        throw new Error('expired');
      }),
    } as unknown as JwtService;
    const guard = new JwtAuthGuard(jwtService, makeUsersService(null), makeAuthService());
    const context = makeContext({ cookies: { tema_session: 'bad.token' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('9) JWT valido + user activo -> deja pasar y setea request.user', async () => {
    const jwtService = { verify: jest.fn(() => ({ sub: 'user-1' })) } as unknown as JwtService;
    const usersService = makeUsersService({ id: 'user-1', active: true, deletedAt: null });
    const guard = new JwtAuthGuard(jwtService, usersService, makeAuthService());
    const request: Record<string, unknown> = { cookies: { tema_session: 'good.token' } };
    const context = makeContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: 'user-1' });
  });

  it('user desactivado despues de emitido el JWT -> 401', async () => {
    const jwtService = { verify: jest.fn(() => ({ sub: 'user-1' })) } as unknown as JwtService;
    const usersService = makeUsersService({ id: 'user-1', active: false, deletedAt: null });
    const guard = new JwtAuthGuard(jwtService, usersService, makeAuthService());
    const context = makeContext({ cookies: { tema_session: 'good.token' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resuelve y expone los roles globales del usuario en request.user.roles', async () => {
    const jwtService = { verify: jest.fn(() => ({ sub: 'user-1' })) } as unknown as JwtService;
    const usersService = makeUsersService({ id: 'user-1', active: true, deletedAt: null });
    const authService = makeAuthService(['ADMIN', 'PROGRAM_MANAGER']);
    const guard = new JwtAuthGuard(jwtService, usersService, authService);
    const request: Record<string, unknown> = { cookies: { tema_session: 'good.token' } };
    const context = makeContext(request);

    await guard.canActivate(context);

    expect(authService.getRoleNames).toHaveBeenCalledWith('user-1');
    expect(request.user).toMatchObject({ id: 'user-1', roles: ['ADMIN', 'PROGRAM_MANAGER'] });
  });

  it('error inesperado de infraestructura (ej. falla de DB en getRoleNames) NO se convierte en 401', async () => {
    const jwtService = { verify: jest.fn(() => ({ sub: 'user-1' })) } as unknown as JwtService;
    const usersService = makeUsersService({ id: 'user-1', active: true, deletedAt: null });
    const dbError = new Error('connection terminated unexpectedly');
    const authService = { getRoleNames: jest.fn(async () => Promise.reject(dbError)) } as unknown as AuthService;
    const guard = new JwtAuthGuard(jwtService, usersService, authService);
    const context = makeContext({ cookies: { tema_session: 'good.token' } });

    // El único catch de todo el guard envuelve jwtService.verify (síncrono); todo lo
    // demás (findById, getRoleNames) no está dentro de ningún try/catch, así que un
    // error real de infraestructura se propaga tal cual y Nest lo convierte en 500,
    // nunca en UnauthorizedException.
    await expect(guard.canActivate(context)).rejects.toBe(dbError);
  });
});
