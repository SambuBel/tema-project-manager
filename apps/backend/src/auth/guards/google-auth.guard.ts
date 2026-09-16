import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { randomBytes } from 'crypto';
import { Response } from 'express';
import { buildOauthStateCookieOptions, OAUTH_STATE_COOKIE_NAME } from '../auth.constants';

/**
 * Guard de GET /auth/google. Genera el `state` anti-CSRF, lo guarda en una cookie
 * de corta vida (HttpOnly) y lo pasa a la Google Strategy para que lo incluya en la
 * URL de autorizacion. GoogleAuthCallbackGuard lo compara contra el que Google
 * devuelva en el callback.
 *
 * Importante: el `state` que se manda a Google es EXACTAMENTE el mismo que se guarda
 * en la cookie (un solo randomBytes, usado en los dos lugares) — si Passport generara
 * su propio `state` interno, la comparación en el callback nunca podría coincidir. La
 * librería `passport-oauth2` solo gestiona su propio state store cuando NO le pasamos
 * un `state` string por afuera (ver `NullStore` en su código); como sí lo pasamos, la
 * librería no interfiere y el único chequeo real de `state` es el nuestro.
 *
 * No usamos express-session: el proyecto no lo tiene y el `state` no necesita mas
 * que una cookie temporal de un solo uso.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  override getAuthenticateOptions(context: ExecutionContext) {
    const response = context.switchToHttp().getResponse<Response>();

    const state = randomBytes(32).toString('hex');
    const isProduction = this.configService.get('NODE_ENV') === 'production';

    response.cookie(OAUTH_STATE_COOKIE_NAME, state, buildOauthStateCookieOptions(isProduction));

    this.logger.debug('Iniciando OAuth con Google: state generado y cookie seteada.');

    return { state };
  }
}
