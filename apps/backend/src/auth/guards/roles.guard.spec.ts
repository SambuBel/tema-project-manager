import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { RequestUser } from '../types/authenticated-request-user';

function makeContext(userRoles: string[] | undefined): ExecutionContext {
  const request = { user: userRoles ? ({ roles: userRoles } as RequestUser) : undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeReflector(metadataRoles: string[] | undefined): Reflector {
  return { getAllAndOverride: jest.fn(() => metadataRoles) } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('sin @Roles() en el endpoint -> deja pasar sin mirar el usuario', () => {
    const guard = new RolesGuard(makeReflector(undefined));
    const context = makeContext(undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('@Roles() con array vacío -> deja pasar', () => {
    const guard = new RolesGuard(makeReflector([]));
    const context = makeContext(['COLLABORATOR']);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('usuario con uno de los roles requeridos -> deja pasar', () => {
    const guard = new RolesGuard(makeReflector(['ADMIN', 'PROGRAM_MANAGER']));
    const context = makeContext(['PROGRAM_MANAGER']);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('usuario con múltiples roles: alcanza con que UNO de ellos matchee (multi-rol)', () => {
    const guard = new RolesGuard(makeReflector(['ADMIN']));
    const context = makeContext(['PROGRAM_MANAGER', 'ADMIN']);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('usuario sin ninguno de los roles requeridos -> 403', () => {
    const guard = new RolesGuard(makeReflector(['ADMIN', 'PROGRAM_MANAGER']));
    const context = makeContext(['COLLABORATOR']);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('request.user ausente (guard mal encadenado, sin JwtAuthGuard antes) -> 403, no rompe', () => {
    const guard = new RolesGuard(makeReflector(['ADMIN']));
    const context = makeContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
