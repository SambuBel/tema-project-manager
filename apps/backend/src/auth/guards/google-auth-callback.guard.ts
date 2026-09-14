import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth.errors';
import { OAUTH_STATE_COOKIE_NAME, oauthStateCookieClearOptions } from '../auth.constants';

type RequestWithAuthError = Request & { authErrorCode?: AuthErrorCode };

/**
 * Guard de GET /auth/google/callback.
 *
 * 1) Valida el `state` ANTES de dejar que Passport intercambie el authorization code
 *    por tokens con Google: si no coincide, ni siquiera se llama a Google.
 * 2) Nunca deja que un fallo se propague como excepcion HTTP generica: todo error
 *    (state invalido, Google devolvió error, sin perfil, etc.) queda en
 *    `request.authErrorCode` para que el controller decida el redirect con el codigo
 *    de error correspondiente (nunca stack traces ni mensajes internos al frontend).
 *
 * Loguea (server-side, saneado) en cada checkpoint para poder diagnosticar en qué
 * etapa falla un login real: nunca imprime el valor del `state`, el authorization
 * code, ni tokens — solo booleans y códigos/mensajes de error ya sanitizados por las
 * librerías de passport (nunca contienen el client secret ni tokens).
 */
@Injectable()
export class GoogleAuthCallbackGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthCallbackGuard.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuthError>();
    const response = context.switchToHttp().getResponse<Response>();

    const isProduction = this.configService.get('NODE_ENV') === 'production';
    const stateCookie: string | undefined = request.cookies?.[OAUTH_STATE_COOKIE_NAME];
    const stateQuery = typeof request.query?.state === 'string' ? request.query.state : undefined;
    const googleErrorCode = typeof request.query?.error === 'string' ? request.query.error : undefined;
    const statesMatch = Boolean(stateCookie) && Boolean(stateQuery) && stateCookie === stateQuery;

    response.clearCookie(OAUTH_STATE_COOKIE_NAME, oauthStateCookieClearOptions(isProduction));

    this.logger.debug({
      msg: '[OAuth callback] chequeo de state',
      hasStateCookie: Boolean(stateCookie),
      hasStateQuery: Boolean(stateQuery),
      statesMatch,
      googleReturnedError: Boolean(googleErrorCode),
    });

    if (!statesMatch) {
      this.logger.warn(
        `[OAuth callback] state inválido o ausente (cookie=${Boolean(stateCookie)}, query=${Boolean(stateQuery)}). ` +
          'Posibles causas: la cookie tema_oauth_state expiró/no llegó, o es un intento sin pasar por /auth/google.',
      );
      request.authErrorCode = AUTH_ERROR_CODES.GOOGLE_AUTH_FAILED;
      return true; // deja pasar a la ruta: el controller redirige con el error, sin tocar Google.
    }

    if (googleErrorCode) {
      // Google mismo reporto un error (ej: el usuario canceló el consentimiento,
      // o la app no está aprobada para ese usuario/dominio en Google Cloud).
      this.logger.warn(`[OAuth callback] Google devolvió error="${googleErrorCode}".`);
      request.authErrorCode = AUTH_ERROR_CODES.GOOGLE_AUTH_FAILED;
      return true;
    }

    return super.canActivate(context) as Promise<boolean>;
  }

  override handleRequest<TUser = unknown>(err: unknown, user: TUser, info?: unknown): TUser | null {
    if (err || !user) {
      // Sanitizado: solo nombre/mensaje del error (las excepciones de passport-oauth2
      // nunca incluyen el client secret ni tokens en su .message), nunca el objeto crudo.
      const errName = err instanceof Error ? err.name : typeof err;
      const errMessage = err instanceof Error ? err.message : undefined;
      this.logger.error(
        `[OAuth callback] Passport no autenticó al usuario. hasUser=${Boolean(user)} ` +
          `hasInfo=${Boolean(info)} errName=${errName} errMessage=${errMessage ?? '(sin mensaje)'}`,
      );
      return null;
    }
    return user;
  }
}
