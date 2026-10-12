import type { QueryClient } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@tema/shared-types';
import { ApiRequestError } from './api';

/**
 * Mensaje para el usuario ante un fallo de POST /auth/login. Para credenciales incorrectas (401) el
 * texto es SIEMPRE el mismo, venga lo que venga del servidor: así la pantalla tampoco revela si el
 * email existe.
 */
export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Email o contraseña incorrectos';
    if (error.status === 403) return 'Tu usuario está deshabilitado. Contactá a un administrador.';
  }
  return 'No se pudo iniciar sesión. Intentá de nuevo.';
}

/** Mensajes para los códigos ?error=... con los que el backend redirige tras el login con Google. */
const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  USER_NOT_REGISTERED: 'Tu cuenta no está registrada en TEMA. Pedile acceso a un administrador.',
  UNAUTHORIZED_DOMAIN: 'El dominio de tu correo no está autorizado.',
  USER_DISABLED: 'Tu usuario está deshabilitado. Contactá a un administrador.',
  EMAIL_NOT_VERIFIED: 'Google no pudo verificar tu correo electrónico.',
  GOOGLE_AUTH_FAILED: 'No se pudo iniciar sesión con Google. Intentá de nuevo.',
};

export function googleErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return GOOGLE_ERROR_MESSAGES[code] ?? GOOGLE_ERROR_MESSAGES.GOOGLE_AUTH_FAILED ?? null;
}

/**
 * Login correcto: se deja al usuario en el cache de /auth/me (lo mismo que ve el resto de la app tras
 * Google) y se redirige a la home. La contraseña no se guarda en ningún lado.
 */
export function handleLoginSuccess(
  user: AuthenticatedUser,
  queryClient: Pick<QueryClient, 'setQueryData'>,
  navigate: (to: string, options?: { replace?: boolean }) => void,
): void {
  queryClient.setQueryData(['auth', 'me'], user);
  navigate('/', { replace: true });
}
