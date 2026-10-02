import type { AuthenticatedUser, Project, ProjectMember, RoleName, Task } from '@tema/shared-types';
import { hasAnyRole } from './roles';

/**
 * Helpers PURAMENTE visuales: deciden qué mostrar/ocultar/deshabilitar en la UI.
 * NO son seguridad — el backend (PermissionsService, ver
 * apps/backend/src/auth/permissions.service.ts) es la única fuente de verdad real.
 * Si un helper de acá queda desactualizado, el peor caso es un botón visible que
 * el backend igual rechaza con 403 — nunca al revés.
 *
 * Nomenclatura espejada a propósito: cada función de acá corresponde 1 a 1 a un
 * método de PermissionsService (mismo nombre, sufijo "UI"). Si cambia una regla
 * del lado del backend, el nombre compartido hace evidente en el diff/review que
 * hay que revisar el otro lado.
 *
 * No reciben `projectId`/`taskId` ni hacen fetch: reciben las entidades que la
 * vista ya tiene cargadas (useCurrentUser, la query del proyecto, la query de
 * membership vía hooks/useMyMembership, la query de la tarea).
 */

const GLOBAL_ROLES = {
  ADMIN_PM: ['ADMIN', 'PROGRAM_MANAGER'] as const,
};

/** Espeja PermissionsService.isProjectLeader: único criterio de liderazgo, nunca projectRole. */
function isProjectLeader(user: AuthenticatedUser, project: Pick<Project, 'leaderId'>): boolean {
  return project.leaderId === user.id;
}

/** Espeja PermissionsService.isAdminPmOrLeader (privado en el backend, se repite acá por claridad). */
function isAdminPmOrLeader(user: AuthenticatedUser, project: Pick<Project, 'leaderId'>): boolean {
  return hasAnyRole(user.roles, [...GLOBAL_ROLES.ADMIN_PM]) || isProjectLeader(user, project);
}

/** Espeja el @Roles(ADMIN, PROGRAM_MANAGER, PROJECT_LEADER) de POST /projects. */
export function canCreateProjectUI(user: AuthenticatedUser): boolean {
  return hasAnyRole(user.roles, ['ADMIN', 'PROGRAM_MANAGER', 'PROJECT_LEADER']);
}

/** Espeja PermissionsService.canManageProject. */
export function canManageProjectUI(user: AuthenticatedUser, project: Pick<Project, 'leaderId'>): boolean {
  return isAdminPmOrLeader(user, project);
}

/** Espeja PermissionsService.canManageProjectTeam (hoy idéntico a canManageProject). */
export function canManageTeamUI(user: AuthenticatedUser, project: Pick<Project, 'leaderId'>): boolean {
  return isAdminPmOrLeader(user, project);
}

/** Espeja el @Roles(ADMIN, PROGRAM_MANAGER) de PATCH /projects/:id/leader. Global, no depende del proyecto. */
export function canChangeLeaderUI(user: AuthenticatedUser): boolean {
  return hasAnyRole(user.roles, [...GLOBAL_ROLES.ADMIN_PM]);
}

/**
 * Espeja PermissionsService.canCreateTask. `membership` es la fila de
 * project_members del usuario ACTUAL en ESTE proyecto (o null si no participa) —
 * ver hooks/useMyMembership. El rol GLOBAL del usuario nunca alcanza acá: solo
 * projectRole === 'COLLABORATOR' en este proyecto puntual habilita crear.
 */
export function canCreateTaskUI(
  user: AuthenticatedUser,
  project: Pick<Project, 'leaderId'>,
  membership: Pick<ProjectMember, 'projectRole'> | null,
): boolean {
  if (isAdminPmOrLeader(user, project)) return true;
  return membership?.projectRole === 'COLLABORATOR';
}

/**
 * Espeja PermissionsService.canEditTask: ADMIN/PM/líder editan cualquiera;
 * COLLABORATOR (projectRole local) solo si creó o tiene asignada la tarea;
 * OBSERVER nunca, sin importar ownership.
 */
export function canEditTaskUI(
  user: AuthenticatedUser,
  task: Pick<Task, 'createdBy' | 'assignedToId'>,
  project: Pick<Project, 'leaderId'>,
  membership: Pick<ProjectMember, 'projectRole'> | null,
): boolean {
  if (isAdminPmOrLeader(user, project)) return true;
  if (membership?.projectRole !== 'COLLABORATOR') return false;
  return task.createdBy === user.id || task.assignedToId === user.id;
}

/**
 * Espeja PermissionsService.canDeleteTask ("eliminar tarea" = archivar, RN-07).
 * A diferencia de canEditTaskUI, nunca depende de membership/ownership: ni el
 * COLLABORATOR dueño/asignado de la tarea puede archivarla.
 */
export function canDeleteTaskUI(user: AuthenticatedUser, project: Pick<Project, 'leaderId'>): boolean {
  return isAdminPmOrLeader(user, project);
}

// ---------------------------------------------------------------------------
// Gestión de roles globales (Users). Espejan PermissionsService.canManageGlobalRoles
// / canAssignGlobalRole / canRemoveGlobalRole / canViewUsers / canManageUserStatus.
// `targetUserId` es el id del usuario sobre el que se quiere actuar — RN-09
// (nadie modifica sus propios roles) se resuelve acá exactamente igual que en
// el backend: comparando contra user.id, nunca confiando en que el backend
// "ya lo va a rechazar" para decidir qué mostrar.
// ---------------------------------------------------------------------------

/** ¿Puede abrir la pantalla "Usuarios y permisos" en algún modo (ADMIN completo, PM restringido)? */
export function canViewUsersUI(user: AuthenticatedUser): boolean {
  return hasAnyRole(user.roles, ['ADMIN', 'PROGRAM_MANAGER']);
}

/** Gestión GENERAL de roles de otro usuario (el editor completo de chips): solo ADMIN, nunca sobre sí mismo. */
export function canManageGlobalRolesUI(user: AuthenticatedUser, targetUserId: string): boolean {
  if (user.id === targetUserId) return false;
  return hasAnyRole(user.roles, ['ADMIN']);
}

/**
 * ADMIN: cualquier rol. PROGRAM_MANAGER: únicamente PROJECT_LEADER (excepción
 * explícita del documento funcional, nunca "si es PM entonces puede todo").
 */
export function canAssignGlobalRoleUI(user: AuthenticatedUser, targetUserId: string, role: RoleName): boolean {
  if (user.id === targetUserId) return false;
  if (hasAnyRole(user.roles, ['ADMIN'])) return true;
  return hasAnyRole(user.roles, ['PROGRAM_MANAGER']) && role === 'PROJECT_LEADER';
}

/** Atajo de canAssignGlobalRoleUI para el único caso que PM tiene permitido: asignar Líder. */
export function canAssignProjectLeaderRoleUI(user: AuthenticatedUser, targetUserId: string): boolean {
  return canAssignGlobalRoleUI(user, targetUserId, 'PROJECT_LEADER');
}

/** Solo ADMIN puede quitar un rol global — ver nota de ambigüedad sobre PM en el informe de esta HU. */
export function canRemoveGlobalRoleUI(user: AuthenticatedUser, targetUserId: string): boolean {
  if (user.id === targetUserId) return false;
  return hasAnyRole(user.roles, ['ADMIN']);
}

/** Activar/desactivar usuarios: solo ADMIN, nunca sobre uno mismo. */
export function canManageUserStatusUI(user: AuthenticatedUser, targetUserId: string): boolean {
  if (user.id === targetUserId) return false;
  return hasAnyRole(user.roles, ['ADMIN']);
}
