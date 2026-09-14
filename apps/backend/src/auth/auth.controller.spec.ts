import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_ERROR_CODES, AuthError, AuthErrorCode } from './auth.errors';
import { UserEntity } from '../database/entities/user.entity';
import { GoogleProfileDto } from './dto/google-profile.dto';

type CallbackRequest = Request & { user?: GoogleProfileDto | null; authErrorCode?: AuthErrorCode };

function makeCallbackRequest(partial: Partial<CallbackRequest>): CallbackRequest {
  return partial as CallbackRequest;
}

function makeResponse(): Response {
  return {
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  } as unknown as Response;
}

function makeConfigService(frontendUrl = 'http://localhost:5173'): ConfigService {
  return { getOrThrow: jest.fn(() => frontendUrl) } as unknown as ConfigService;
}

describe('AuthController', () => {
  it('9) /auth/me autenticado -> devuelve solo datos seguros (sin tokens/columnas internas)', async () => {
    const authService = {
      getRoleNames: jest.fn(async () => ['COLLABORATOR']),
      toAuthenticatedUserDto: jest.fn((user: UserEntity, roles: string[]) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        roles,
      })),
    } as unknown as AuthService;
    const controller = new AuthController(authService, makeConfigService());

    const user = { id: 'u1', email: 'x@empresa.com', name: 'X', avatarUrl: null } as UserEntity;
    const result = await controller.me(user);

    expect(result).toEqual({
      id: 'u1',
      email: 'x@empresa.com',
      name: 'X',
      avatarUrl: null,
      roles: ['COLLABORATOR'],
    });
    expect(result).not.toHaveProperty('active');
    expect(result).not.toHaveProperty('deletedAt');
  });

  it('10) logout -> limpia la cookie de sesión y responde 204', () => {
    const authService = { clearSessionCookie: jest.fn() } as unknown as AuthService;
    const controller = new AuthController(authService, makeConfigService());
    const res = makeResponse();

    controller.logout(res);

    expect(authService.clearSessionCookie).toHaveBeenCalledWith(res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it('callback: dominio no autorizado -> redirige a FRONTEND_URL/login?error=UNAUTHORIZED_DOMAIN, sin loguear al usuario', async () => {
    const authService = {
      loginWithGoogle: jest.fn(async () => {
        throw new AuthError(AUTH_ERROR_CODES.UNAUTHORIZED_DOMAIN);
      }),
    } as unknown as AuthService;
    const controller = new AuthController(authService, makeConfigService());
    const res = makeResponse();
    const req = makeCallbackRequest({ user: { email: 'x@no-autorizado.com' } as GoogleProfileDto });

    await controller.googleCallback(req, res);

    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=UNAUTHORIZED_DOMAIN'));
  });

  it('callback: authErrorCode seteado por el guard (state invalido) -> redirige sin llamar a loginWithGoogle', async () => {
    const authService = { loginWithGoogle: jest.fn() } as unknown as AuthService;
    const controller = new AuthController(authService, makeConfigService());
    const res = makeResponse();
    const req = makeCallbackRequest({ authErrorCode: AUTH_ERROR_CODES.GOOGLE_AUTH_FAILED });

    await controller.googleCallback(req, res);

    expect(authService.loginWithGoogle).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=GOOGLE_AUTH_FAILED'));
  });
});
