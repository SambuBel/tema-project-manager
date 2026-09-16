import { Controller, Get, HttpCode, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleAuthCallbackGuard } from './guards/google-auth-callback.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserEntity } from '../database/entities/user.entity';
import { GoogleProfileDto } from './dto/google-profile.dto';
import { AUTH_ERROR_CODES, AuthError, AuthErrorCode } from './auth.errors';

type CallbackRequest = Request & { user?: GoogleProfileDto | null; authErrorCode?: AuthErrorCode };

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Inicia el flujo. El guard hace todo el trabajo (genera `state`, redirige a Google);
   * este metodo nunca se ejecuta en la practica.
   */
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleLogin(): void {}

  @Get('google/callback')
  @UseGuards(GoogleAuthCallbackGuard)
  async googleCallback(@Req() req: CallbackRequest, @Res() res: Response): Promise<void> {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');

    if (req.authErrorCode) {
      // Seteado por GoogleAuthCallbackGuard (state inválido, o Google devolvió error):
      // el detalle sanitizado de POR QUÉ ya quedó logueado ahí, esto es solo el eco.
      this.logger.warn(`Callback rechazado por el guard con code=${req.authErrorCode}.`);
      this.redirectWithError(res, frontendUrl, req.authErrorCode);
      return;
    }

    if (!req.user) {
      this.logger.warn('Callback sin req.user (Passport no autenticó); ver log de GoogleAuthCallbackGuard.');
      this.redirectWithError(res, frontendUrl, AUTH_ERROR_CODES.GOOGLE_AUTH_FAILED);
      return;
    }

    try {
      const user = await this.authService.loginWithGoogle(req.user);
      const token = this.authService.signSessionToken(user.id);
      this.authService.setSessionCookie(res, token);
      this.logger.log(`Login con Google OK para userId=${user.id}.`);
      res.redirect(frontendUrl);
    } catch (error) {
      if (error instanceof AuthError) {
        this.logger.warn(`loginWithGoogle rechazado con code=${error.code}.`);
        this.redirectWithError(res, frontendUrl, error.code);
        return;
      }
      // Error inesperado (bug, config faltante, DB caida): no se filtra nada interno al cliente,
      // pero el detalle completo (con stack) SÍ queda en el log del servidor.
      this.logger.error('Fallo inesperado en el login con Google.', error instanceof Error ? error.stack : error);
      this.redirectWithError(res, frontendUrl, AUTH_ERROR_CODES.GOOGLE_AUTH_FAILED);
    }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: UserEntity) {
    const roles = await this.authService.getRoleNames(user.id);
    return this.authService.toAuthenticatedUserDto(user, roles);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res() res: Response): void {
    this.authService.clearSessionCookie(res);
    res.status(204).send();
  }

  private redirectWithError(res: Response, frontendUrl: string, code: AuthErrorCode): void {
    const url = new URL('/login', frontendUrl);
    url.searchParams.set('error', code);
    res.redirect(url.toString());
  }
}
