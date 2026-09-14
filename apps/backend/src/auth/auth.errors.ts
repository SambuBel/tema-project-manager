/**
 * Codigos de error estables para el callback de login. Van en la query string del
 * redirect al frontend (?error=CODE) — nunca mensajes internos ni stack traces.
 */
export const AUTH_ERROR_CODES = {
  UNAUTHORIZED_DOMAIN: 'UNAUTHORIZED_DOMAIN',
  USER_DISABLED: 'USER_DISABLED',
  GOOGLE_AUTH_FAILED: 'GOOGLE_AUTH_FAILED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

/** Error de dominio esperado durante el login (a diferencia de un error inesperado/de bug). */
export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AuthError';
  }
}
