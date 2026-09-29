import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { RequestUser } from '../types/authenticated-request-user';

/**
 * Azucar sobre request.user, seteado por JwtAuthGuard. Usar siempre junto a
 * @UseGuards(JwtAuthGuard) — sin el guard, request.user no existe.
 * Incluye `roles` (ver RequestUser), ya resueltos por JwtAuthGuard.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();
  return request.user;
});
