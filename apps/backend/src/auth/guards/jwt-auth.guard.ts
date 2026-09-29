import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { SESSION_COOKIE_NAME } from '../auth.constants';
import { AuthService, SessionJwtPayload } from '../auth.service';
import { RequestUser } from '../types/authenticated-request-user';
import { RoleName } from '../../database/enums';

/**
 * Guard reutilizable para cualquier endpoint que requiera usuario autenticado:
 *   @UseGuards(JwtAuthGuard)
 * Lee el JWT propio desde la cookie HttpOnly (nunca desde Authorization header,
 * para no obligar al frontend a manejar tokens), lo valida, carga el usuario real
 * (asi un usuario borrado/desactivado despues de emitido el JWT no sigue "logueado")
 * y lo deja en request.user para @CurrentUser().
 *
 * También resuelve los roles GLOBALES del usuario y los deja en request.user.roles,
 * para que RolesGuard (y cualquier otro consumidor) no tenga que volver a
 * consultarlos. Sigue siendo SOLO autenticación: no decide si esos roles alcanzan
 * para la acción pedida, eso es responsabilidad de RolesGuard/PermissionsService.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
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

    const roles = (await this.authService.getRoleNames(user.id)) as RoleName[];
    const requestUser: RequestUser = Object.assign(user, { roles });

    (request as Request & { user?: RequestUser }).user = requestUser;
    return true;
  }
}
