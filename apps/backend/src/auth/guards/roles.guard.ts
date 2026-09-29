import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RequestUser } from '../types/authenticated-request-user';
import { RoleName } from '../../database/enums';

/**
 * RBAC global (autorización, no autenticación): responde "¿el rol global del
 * usuario alcanza para esta acción?", sin mirar ningún recurso puntual.
 *
 * Siempre va DESPUÉS de JwtAuthGuard en la cadena de @UseGuards — necesita
 * request.user.roles ya resuelto; si el endpoint no tiene @Roles(...), deja pasar
 * (ese caso es "cualquier autenticado", ya cubierto por JwtAuthGuard solo).
 *
 * Autenticación (401) es responsabilidad de JwtAuthGuard. Este guard corre
 * DESPUÉS de que ya se confirmó que hay un usuario válido, así que la única
 * respuesta posible acá es 403.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const userRoles = request.user?.roles ?? [];
    const hasRequiredRole = requiredRoles.some((role) => userRoles.includes(role));

    if (!hasRequiredRole) {
      throw new ForbiddenException('No tenés permisos para realizar esta acción.');
    }

    return true;
  }
}
