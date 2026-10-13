import type { RoleName, UserWithRoles } from '@tema/shared-types';

/**
 * Filtros y orden de la pantalla "Usuarios y permisos". Se resuelven en memoria sobre el listado completo
 * (una sola consulta, con desactivados incluidos): buscar o filtrar no dispara requests.
 */
export type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
export type RoleFilter = 'ALL' | RoleName;
export type UserSort = 'NAME_ASC' | 'NAME_DESC' | 'NEWEST';

export interface UserFilters {
  search: string;
  status: StatusFilter;
  role: RoleFilter;
  sort: UserSort;
}

export const DEFAULT_USER_FILTERS: UserFilters = { search: '', status: 'ALL', role: 'ALL', sort: 'NAME_ASC' };

export const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'ACTIVE', label: 'Activos' },
  { value: 'INACTIVE', label: 'Inactivos' },
];

export const ROLE_FILTER_OPTIONS: ReadonlyArray<{ value: RoleFilter; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'PROGRAM_MANAGER', label: 'Program Manager' },
  { value: 'PROJECT_LEADER', label: 'Líder de proyecto' },
  { value: 'COLLABORATOR', label: 'Colaborador' },
  { value: 'OBSERVER', label: 'Observador' },
];

export const SORT_OPTIONS: ReadonlyArray<{ value: UserSort; label: string }> = [
  { value: 'NAME_ASC', label: 'Nombre A-Z' },
  { value: 'NAME_DESC', label: 'Nombre Z-A' },
  { value: 'NEWEST', label: 'Más recientes' },
];

/** ¿Hay algún FILTRO (búsqueda, estado o rol) distinto del default? El orden no es un filtro. */
export function hasActiveFilters(filters: UserFilters): boolean {
  return filters.search.trim() !== '' || filters.status !== DEFAULT_USER_FILTERS.status || filters.role !== DEFAULT_USER_FILTERS.role;
}

/** Limpia los filtros (búsqueda, estado, rol) y conserva el orden elegido. */
export function clearFilters(filters: UserFilters): UserFilters {
  return { ...DEFAULT_USER_FILTERS, sort: filters.sort };
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

function compareByName(a: UserWithRoles, b: UserWithRoles): number {
  return collator.compare(a.name, b.name) || collator.compare(a.email, b.email);
}

function timestamp(user: UserWithRoles): number {
  const time = Date.parse(user.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Aplica TODOS los criterios a la vez (se componen con AND):
 *  - búsqueda: nombre o email, sin distinguir mayúsculas;
 *  - estado: el campo real `active` (no se infiere de los roles);
 *  - rol: revisa `user.roles` COMPLETO, así un usuario [COLLABORATOR, OBSERVER] aparece en ambos filtros.
 * Devuelve una copia ordenada; no muta la entrada.
 */
export function filterAndSortUsers(users: readonly UserWithRoles[], filters: UserFilters): UserWithRoles[] {
  const term = filters.search.trim().toLowerCase();

  const result = users.filter((user) => {
    if (term && !user.name.toLowerCase().includes(term) && !user.email.toLowerCase().includes(term)) return false;
    if (filters.status === 'ACTIVE' && !user.active) return false;
    if (filters.status === 'INACTIVE' && user.active) return false;
    if (filters.role !== 'ALL' && !user.roles.includes(filters.role)) return false;
    return true;
  });

  switch (filters.sort) {
    case 'NAME_DESC':
      return result.sort((a, b) => compareByName(b, a));
    case 'NEWEST':
      return result.sort((a, b) => timestamp(b) - timestamp(a) || compareByName(a, b));
    default:
      return result.sort(compareByName);
  }
}
