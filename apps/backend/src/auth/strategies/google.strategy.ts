import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, StrategyOptions, VerifyCallback, Profile } from 'passport-google-oauth20';
import { GoogleProfileDto } from '../dto/google-profile.dto';

/** Campo crudo que Google incluye en el perfil pero passport-google-oauth20 no tipa bien. */
type GoogleRawProfile = Profile & {
  _json?: Profile['_json'] & { email_verified?: boolean };
};

/**
 * Solo se encarga de hablar OAuth2/OIDC con Google y normalizar el perfil recibido.
 * A proposito NO valida dominios ni toca la base: eso es responsabilidad de AuthService,
 * asi la logica de negocio queda testeable sin pasar por Passport.
 *
 * No persistimos access_token/refresh_token de Google: hoy solo lo usamos como
 * proveedor de identidad, no para llamar APIs de Google despues.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    const options: StrategyOptions = {
      clientID: configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['openid', 'email', 'profile'],
    };
    super(options);
  }

  validate(
    _accessToken: string,
    _refreshToken: string | undefined,
    profile: GoogleRawProfile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Google no devolvió un email en el perfil.'));
      return;
    }

    const dto: GoogleProfileDto = {
      providerSubject: profile.id,
      email,
      emailVerified: profile.emails?.[0]?.verified === true || profile._json?.email_verified === true,
      name: profile.displayName ?? email,
      avatarUrl: profile.photos?.[0]?.value ?? null,
    };

    done(null, dto as unknown as Express.User);
  }
}
