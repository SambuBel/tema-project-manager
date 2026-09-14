import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { SESSION_COOKIE_NAME } from '../auth.constants';
import { SessionJwtPayload } from '../auth.service';

/**
 * Guard reutilizable para cualquier endpoint que requiera usuario autenticado:
 *   @UseGuards(JwtAuthGuard)
 * Lee el JWT propio desde la cookie HttpOnly (nunca desde Authorization header,
 * para no obligar al frontend a manejar tokens), lo valida, carga el usuario real
 * (asi un usuario borrado/desactivado despues de emitido el JWT no sigue "logueado")
 * y lo deja en request.user para @CurrentUser().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token: string | undefined = request.cookies?.[SESSION_COOKIE_NAME];

    if (!token) {
      throw new UnauthorizedException('No hay sesión activa.');
    }

    let payload: SessionJwtPayload;
    try {
      payload = this.jwtService.verify<SessionJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.active || user.deletedAt) {
      throw new UnauthorizedException('Usuario inválido o deshabilitado.');
    }

    (request as Request & { user?: unknown }).user = user;
    return true;
  }
}
