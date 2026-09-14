import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../../users/users.service';
import { UserEntity } from '../../database/entities/user.entity';

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

describe('JwtAuthGuard', () => {
  it('8) sin cookie de sesión -> 401', async () => {
    const jwtService = { verify: jest.fn() } as unknown as JwtService;
    const guard = new JwtAuthGuard(jwtService, makeUsersService(null));
    const context = makeContext({ cookies: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('JWT invalido/expirado -> 401', async () => {
    const jwtService = {
      verify: jest.fn(() => {
        throw new Error('expired');
      }),
    } as unknown as JwtService;
    const guard = new JwtAuthGuard(jwtService, makeUsersService(null));
    const context = makeContext({ cookies: { tema_session: 'bad.token' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('9) JWT valido + user activo -> deja pasar y setea request.user', async () => {
    const jwtService = { verify: jest.fn(() => ({ sub: 'user-1' })) } as unknown as JwtService;
    const usersService = makeUsersService({ id: 'user-1', active: true, deletedAt: null });
    const guard = new JwtAuthGuard(jwtService, usersService);
    const request: Record<string, unknown> = { cookies: { tema_session: 'good.token' } };
    const context = makeContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: 'user-1' });
  });

  it('user desactivado despues de emitido el JWT -> 401', async () => {
    const jwtService = { verify: jest.fn(() => ({ sub: 'user-1' })) } as unknown as JwtService;
    const usersService = makeUsersService({ id: 'user-1', active: false, deletedAt: null });
    const guard = new JwtAuthGuard(jwtService, usersService);
    const context = makeContext({ cookies: { tema_session: 'good.token' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
