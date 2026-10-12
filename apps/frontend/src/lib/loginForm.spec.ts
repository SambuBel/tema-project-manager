import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '@tema/shared-types';
import { api, ApiRequestError } from './api';
import { googleErrorMessage, handleLoginSuccess, loginErrorMessage } from './loginForm';

const user: AuthenticatedUser = { id: 'u1', email: 'a@tema.com', name: 'Ana', avatarUrl: null, roles: ['COLLABORATOR'] };

describe('loginErrorMessage', () => {
  it('401 → mensaje genérico, SIEMPRE el mismo aunque el servidor diga otra cosa (no revela si el email existe)', () => {
    expect(loginErrorMessage(new ApiRequestError(401, 'Unauthorized', ['Email o contraseña incorrectos']))).toBe('Email o contraseña incorrectos');
    expect(loginErrorMessage(new ApiRequestError(401, 'Unauthorized', ['el usuario existe pero la clave está mal']))).toBe('Email o contraseña incorrectos');
  });

  it('403 → usuario deshabilitado', () => {
    expect(loginErrorMessage(new ApiRequestError(403, 'Forbidden', []))).toContain('deshabilitado');
  });

  it('cualquier otro error (red, 500) → mensaje neutro', () => {
    expect(loginErrorMessage(new ApiRequestError(500, 'Server Error', []))).toBe('No se pudo iniciar sesión. Intentá de nuevo.');
    expect(loginErrorMessage(new TypeError('Failed to fetch'))).toBe('No se pudo iniciar sesión. Intentá de nuevo.');
  });
});

describe('googleErrorMessage (?error= del callback de Google)', () => {
  it('USER_NOT_REGISTERED → explica que la cuenta no está registrada', () => {
    expect(googleErrorMessage('USER_NOT_REGISTERED')).toContain('no está registrada');
  });

  it.each(['UNAUTHORIZED_DOMAIN', 'USER_DISABLED', 'EMAIL_NOT_VERIFIED', 'GOOGLE_AUTH_FAILED'])('%s tiene mensaje', (code) => {
    expect(googleErrorMessage(code)).toBeTruthy();
  });

  it('código desconocido → mensaje genérico de Google; sin código → null (no se muestra nada)', () => {
    expect(googleErrorMessage('LO_QUE_SEA')).toBe(googleErrorMessage('GOOGLE_AUTH_FAILED'));
    expect(googleErrorMessage(null)).toBeNull();
  });
});

describe('handleLoginSuccess', () => {
  it('deja al usuario en el cache de /auth/me y redirige a la home reemplazando /login', () => {
    const queryClient = { setQueryData: vi.fn() };
    const navigate = vi.fn();

    handleLoginSuccess(user, queryClient, navigate);

    expect(queryClient.setQueryData).toHaveBeenCalledWith(['auth', 'me'], user);
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });
});

describe('api.login', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /api/auth/login con email y contraseña, mandando la cookie de sesión', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(user), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.login({ email: 'a@tema.com', password: 'secreta-123' })).resolves.toEqual(user);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@tema.com', password: 'secreta-123' });
  });

  it('credenciales incorrectas → ApiRequestError 401 (sin redirigir ni recargar la página)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Email o contraseña incorrectos' }), { status: 401 })));

    const error = (await api.login({ email: 'a@tema.com', password: 'mala' }).catch((e: unknown) => e)) as ApiRequestError;

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(401);
    expect(loginErrorMessage(error)).toBe('Email o contraseña incorrectos');
  });
});
