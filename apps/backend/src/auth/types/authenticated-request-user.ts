import { UserEntity } from '../../database/entities/user.entity';
import { RoleName } from '../../database/enums';

/**
 * Lo que JwtAuthGuard deja en request.user: el usuario real más sus roles GLOBALES
 * ya resueltos (evita que RolesGuard, o cualquier otro lugar, tenga que volver a
 * consultar user_roles). CurrentUser() devuelve esto mismo.
 */
export type RequestUser = UserEntity & { roles: RoleName[] };
