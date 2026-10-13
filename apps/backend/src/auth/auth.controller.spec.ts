import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
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

  describe('POST /auth/login (email + contraseña)', () => {
    const user = { id: 'u1', email: 'x@empresa.com', name: 'X', avatarUrl: null, passwordHash: null } as UserEntity;

    function makeAuthService(loginResult: () => Promise<UserEntity>) {
      return {
        loginWithPassword: jest.fn(loginResult),
        signSessionToken: jest.fn(() => 'jwt-propio'),
        setSessionCookie: jest.fn(),
        getRoleNames: jest.fn(async () => ['COLLABORATOR']),
        toAuthenticatedUserDto: jest.fn((u: UserEntity, roles: string[]) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          avatarUrl: u.avatarUrl,
          roles,
        })),
      } as unknown as AuthService;
    }

    it('credenciales correctas → emite la MISMA cookie de sesión (JWT propio) y devuelve solo datos seguros', async () => {
      const authService = makeAuthService(async () => user);
      const controller = new AuthController(authService, makeConfigService());
      const res = makeResponse();

      const result = await controller.login({ email: 'x@empresa.com', password: 'secreta-123' }, res);

      expect(authService.loginWithPassword).toHaveBeenCalledWith('x@empresa.com', 'secreta-123');
      expect(authService.signSessionToken).toHaveBeenCalledWith('u1');
      expect(authService.setSessionCookie).toHaveBeenCalledWith(res, 'jwt-propio');
      expect(result).toEqual({ id: 'u1', email: 'x@empresa.com', name: 'X', avatarUrl: null, roles: ['COLLABORATOR'] });
      expect(JSON.stringify(result)).not.toMatch(/password|hash/i);
    });

    it('INVALID_CREDENTIALS → 401 con mensaje genérico y SIN cookie', async () => {
      const authService = makeAuthService(async () => {
        throw new AuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
      });
      const controller = new AuthController(authService, makeConfigService());

      const error = await controller.login({ email: 'x@empresa.com', password: 'mal' }, makeResponse()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe('Email o contraseña incorrectos');
      expect(authService.setSessionCookie).not.toHaveBeenCalled();
    });

    it('usuario deshabilitado → 403 y SIN cookie', async () => {
      const authService = makeAuthService(async () => {
        throw new AuthError(AUTH_ERROR_CODES.USER_DISABLED);
      });
      const controller = new AuthController(authService, makeConfigService());

      await expect(controller.login({ email: 'x@empresa.com', password: 'ok' }, makeResponse())).rejects.toBeInstanceOf(ForbiddenException);
      expect(authService.setSessionCookie).not.toHaveBeenCalled();
    });

    it('un error inesperado NO se disfraza de 401: se propaga', async () => {
      const authService = makeAuthService(async () => {
        throw new Error('db caída');
      });
      const controller = new AuthController(authService, makeConfigService());
      await expect(controller.login({ email: 'a@b.com', password: 'x' }, makeResponse())).rejects.toThrow('db caída');
    });
  });

  it('callback de Google con usuario NO registrado → redirige a /login?error=USER_NOT_REGISTERED, sin sesión', async () => {
    const authService = {
      loginWithGoogle: jest.fn(async () => {
        throw new AuthError(AUTH_ERROR_CODES.USER_NOT_REGISTERED);
      }),
      signSessionToken: jest.fn(),
      setSessionCookie: jest.fn(),
    } as unknown as AuthService;
    const controller = new AuthController(authService, makeConfigService());
    const res = makeResponse();

    await controller.googleCallback(
      makeCallbackRequest({ user: { providerSubject: 's', email: 'nadie@tema.com', emailVerified: true, name: 'N', avatarUrl: null } }),
      res,
    );

    expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173/login?error=USER_NOT_REGISTERED');
    expect(authService.setSessionCookie).not.toHaveBeenCalled();
  });
});
