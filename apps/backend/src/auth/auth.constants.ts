import { CookieOptions } from 'express';

/** Cookie con la sesion de NUESTRA app (JWT propio). Nunca contiene tokens de Google. */
export const SESSION_COOKIE_NAME = 'tema_session';
export const SESSION_COOKIE_PATH = '/';

/** Cookie temporal que guarda el `state` anti-CSRF durante el handshake con Google. */
export const OAUTH_STATE_COOKIE_NAME = 'tema_oauth_state';
export const OAUTH_STATE_COOKIE_PATH = '/api/auth';
export const OAUTH_STATE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Centraliza las opciones de las cookies propias para que quien las crea y quien las
 * borra (clearCookie) nunca queden desincronizados en `path`/`sameSite`/etc — solo
 * `maxAge` cambia entre creación y borrado (clearCookie no lo necesita).
 */
export function buildOauthStateCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: OAUTH_STATE_COOKIE_MAX_AGE_MS,
    path: OAUTH_STATE_COOKIE_PATH,
  };
}

export function oauthStateCookieClearOptions(isProduction: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: isProduction, path: OAUTH_STATE_COOKIE_PATH };
}

export function buildSessionCookieOptions(isProduction: boolean, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: maxAgeMs,
    path: SESSION_COOKIE_PATH,
  };
}

export function sessionCookieClearOptions(isProduction: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: isProduction, path: SESSION_COOKIE_PATH };
}
