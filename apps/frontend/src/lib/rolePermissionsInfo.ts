import type { RoleName } from '@tema/shared-types';

/**
 * Contenido INFORMATIVO para la pantalla "Roles y permisos": qué puede/no puede
 * hacer cada rol. Refleja las policies reales de PermissionsService
 * (apps/backend/src/auth/permissions.service.ts) traducidas a lenguaje llano —
 * no se deriva dinámicamente del backend (no hay introspección de policies), así
 * que si una regla cambia ahí, hay que actualizar esto a mano. Es solo
 * referencia para el usuario: nunca se usa para decidir qué mostrar/ocultar en
 * el resto de la UI (para eso está lib/permissions.ts).
 */
export interface RolePermissionsInfo {
  description: string;
  can: string[];
  cannot: string[];
}

export const rolePermissionsInfo: Record<RoleName, RolePermissionsInfo> = {
  ADMIN: {
    description: 'Rol técnico, con acceso total a la plataforma.',
    can: [
      'Ver y administrar todos los proyectos, sea o no miembro',
      'Crear proyectos',
      'Administrar el equipo de cualquier proyecto',
      'Crear, editar y eliminar cualquier tarea',
      'Cambiar el líder de cualquier proyecto',
      'Definir presupuestos y gestionar costos',
      'Ver la información económica de cualquier proyecto',
    ],
    cannot: [],
  },
  PROGRAM_MANAGER: {
    description: 'Rol de negocio: gestiona el portfolio completo sin necesitar ser técnico.',
    can: [
      'Ver y administrar todos los proyectos, sea o no miembro',
      'Crear proyectos',
      'Administrar el equipo de cualquier proyecto',
      'Crear, editar y eliminar cualquier tarea',
      'Cambiar el líder de cualquier proyecto',
      'Definir presupuestos y gestionar costos',
      'Ver la información económica de cualquier proyecto',
    ],
    cannot: [],
  },
  PROJECT_LEADER: {
    description:
      'Puede liderar proyectos. Tener este rol global no da acceso a ningún proyecto por sí solo: cada proyecto tiene UN líder (project.leaderId), y los permisos de líder solo aplican ahí.',
    can: [
      'Crear proyectos (queda como líder del que crea)',
      'Administrar los proyectos donde es líder',
      'Administrar el equipo de esos proyectos',
      'Crear, editar y eliminar cualquier tarea de esos proyectos',
      'Registrar y editar costos de esos proyectos',
      'Ver la información económica de esos proyectos',
    ],
    cannot: [
      'Administrar usuarios',
      'Definir presupuestos (solo ADMIN/PROGRAM_MANAGER)',
      'Acceder automáticamente a proyectos donde no es líder ni miembro',
      'Cambiar el líder de un proyecto (eso lo hacen ADMIN/PROGRAM_MANAGER)',
    ],
  },
  COLLABORATOR: {
    description:
      'Participa en proyectos concretos. El rol global no alcanza: en cada proyecto tiene además un rol local (COLLABORATOR u OBSERVER) que es el que realmente decide qué puede hacer ahí.',
    can: [
      'Ver los proyectos donde participa',
      'Crear tareas en los proyectos donde su rol local es COLLABORATOR',
      'Editar tareas que creó o que tiene asignadas, en esos proyectos',
    ],
    cannot: [
      'Crear proyectos',
      'Administrar el equipo de un proyecto',
      'Eliminar tareas',
      'Editar tareas de otras personas',
      'Ver información económica',
      'Actuar como COLLABORATOR en un proyecto donde su rol local es OBSERVER (solo lectura ahí, aunque su rol global sea COLLABORATOR)',
    ],
  },
  OBSERVER: {
    description: 'Acceso de solo lectura a los proyectos donde participa.',
    can: ['Ver los proyectos y tareas donde participa'],
    cannot: [
      'Crear, editar o eliminar tareas',
      'Crear proyectos',
      'Administrar el equipo',
      'Ver información económica',
    ],
  },
};
