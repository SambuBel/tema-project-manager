import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { UserEntity } from '../../database/entities/user.entity';

/**
 * Azucar sobre request.user, seteado por JwtAuthGuard. Usar siempre junto a
 * @UseGuards(JwtAuthGuard) — sin el guard, request.user no existe.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserEntity => {
  const request = ctx.switchToHttp().getRequest<Request & { user: UserEntity }>();
  return request.user;
});
