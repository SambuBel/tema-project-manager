import type { RoleName } from '@tema/shared-types';

/** De mayor a menor jerarquia; el primero que tenga el usuario es su rol principal. */
const ROLE_PRIORITY: RoleName[] = ['ADMIN', 'PROGRAM_MANAGER', 'PROJECT_LEADER', 'COLLABORATOR', 'OBSERVER'];

export const roleLabels: Record<RoleName, string> = {
  ADMIN: 'Administrador',
  PROGRAM_MANAGER: 'Program Manager',
  PROJECT_LEADER: 'Líder de proyecto',
  COLLABORATOR: 'Colaborador',
  OBSERVER: 'Observador',
};

export function getPrimaryRole(roles: readonly RoleName[]): RoleName | null {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null;
}

export function hasAnyRole(roles: readonly RoleName[], allowed: readonly RoleName[]): boolean {
  return allowed.some((r) => roles.includes(r));
}
