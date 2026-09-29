import { SetMetadata } from '@nestjs/common';
import { RoleName } from '../../database/enums';

export const ROLES_KEY = 'roles';

/**
 * RBAC global: exige que el usuario autenticado tenga AL MENOS UNO de los roles
 * indicados. Solo sirve para reglas que no dependen de un recurso concreto (ej.
 * "quién puede crear un proyecto"); las reglas contextuales (ownership/membership)
 * van en PermissionsService, no acá — ver auth/permissions.service.ts.
 *
 * Requiere JwtAuthGuard antes en la cadena de guards (RolesGuard lee request.user).
 */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
