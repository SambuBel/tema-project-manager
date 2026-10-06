import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { RoleEntity } from '../database/entities/role.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

/**
 * AuthModule ya importa UsersModule (UsersService lo usa JwtAuthGuard/AuthService
 * para cargar al usuario autenticado). UsersService ahora necesita a su vez
 * PermissionsService (que vive en AuthModule) para las policies de roles
 * globales — de ahí el forwardRef en ambos lados, el patrón estándar de Nest
 * para este tipo de dependencia circular entre módulos.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, RoleEntity, UserRoleEntity]), forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
