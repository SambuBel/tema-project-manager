import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser, Project, ProjectMember, RoleName, Task } from '@tema/shared-types';
import {
  canAssignGlobalRoleUI,
  canAssignProjectLeaderRoleUI,
  canChangeLeaderUI,
  canCreateProjectUI,
  canCreateTaskUI,
  canDeleteTaskUI,
  canEditTaskUI,
  canManageGlobalRolesUI,
  canManageProjectUI,
  canManageTeamUI,
  canManageUserStatusUI,
  canRemoveGlobalRoleUI,
  canViewUsersUI,
} from './permissions';

const PROJECT_ID = 'project-1';
const LEADER_ID = 'leader-1';

function makeUser(id: string, roles: RoleName[]): AuthenticatedUser {
  return { id, email: `${id}@tema.com`, name: id, avatarUrl: null, roles };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    name: 'Proyecto',
    description: null,
    startDate: null,
    estimatedEndDate: null,
    status: 'IN_PROGRESS',
    leaderId: LEADER_ID,
    createdBy: LEADER_ID,
    createdAt: '',
    updatedAt: '',
    archivedAt: null,
    ...overrides,
  };
}

function makeMembership(projectRole: ProjectMember['projectRole']): ProjectMember {
  return {
    id: 'member-1',
    projectId: PROJECT_ID,
    userId: 'u1',
    projectRole,
    joinedAt: '',
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: PROJECT_ID,
    parentTaskId: null,
    title: 'Tarea',
    description: null,
    status: 'PENDING',
    priority: 'MEDIUM',
    assignedToId: null,
    startDate: null,
    dueDate: null,
    createdBy: 'someone-else',
    createdAt: '',
    updatedAt: '',
    archivedAt: null,
    ...overrides,
  };
}

describe('canCreateProjectUI', () => {
  it('ADMIN, PROGRAM_MANAGER y PROJECT_LEADER pueden', () => {
    expect(canCreateProjectUI(makeUser('u1', ['ADMIN']))).toBe(true);
    expect(canCreateProjectUI(makeUser('u1', ['PROGRAM_MANAGER']))).toBe(true);
    expect(canCreateProjectUI(makeUser('u1', ['PROJECT_LEADER']))).toBe(true);
  });

  it('COLLABORATOR y OBSERVER no pueden', () => {
    expect(canCreateProjectUI(makeUser('u1', ['COLLABORATOR']))).toBe(false);
    expect(canCreateProjectUI(makeUser('u1', ['OBSERVER']))).toBe(false);
  });
});

describe('canManageProjectUI / canManageTeamUI', () => {
  const project = makeProject();

  it('ADMIN y PROGRAM_MANAGER pueden en cualquier proyecto', () => {
    expect(canManageProjectUI(makeUser('admin-1', ['ADMIN']), project)).toBe(true);
    expect(canManageTeamUI(makeUser('pm-1', ['PROGRAM_MANAGER']), project)).toBe(true);
  });

  it('el líder del proyecto puede', () => {
    expect(canManageProjectUI(makeUser(LEADER_ID, ['PROJECT_LEADER']), project)).toBe(true);
  });

  it('PROJECT_LEADER de OTRO proyecto no puede (el rol global no alcanza)', () => {
    expect(canManageProjectUI(makeUser('otro-leader', ['PROJECT_LEADER']), project)).toBe(false);
  });

  it('COLLABORATOR y OBSERVER nunca pueden administrar', () => {
    expect(canManageProjectUI(makeUser('u1', ['COLLABORATOR']), project)).toBe(false);
    expect(canManageProjectUI(makeUser('u1', ['OBSERVER']), project)).toBe(false);
  });

  it('multi-rol: ADMIN + PROGRAM_MANAGER conserva el permiso', () => {
    expect(canManageProjectUI(makeUser('u1', ['ADMIN', 'PROGRAM_MANAGER']), project)).toBe(true);
  });
});

describe('canChangeLeaderUI', () => {
  it('solo ADMIN/PROGRAM_MANAGER, sin importar el proyecto', () => {
    expect(canChangeLeaderUI(makeUser('admin-1', ['ADMIN']))).toBe(true);
    expect(canChangeLeaderUI(makeUser('pm-1', ['PROGRAM_MANAGER']))).toBe(true);
    expect(canChangeLeaderUI(makeUser(LEADER_ID, ['PROJECT_LEADER']))).toBe(false);
    expect(canChangeLeaderUI(makeUser('u1', ['COLLABORATOR']))).toBe(false);
  });
});

describe('canCreateTaskUI', () => {
  const project = makeProject();

  it('ADMIN y PROGRAM_MANAGER pueden sin ser miembros', () => {
    expect(canCreateTaskUI(makeUser('admin-1', ['ADMIN']), project, null)).toBe(true);
    expect(canCreateTaskUI(makeUser('pm-1', ['PROGRAM_MANAGER']), project, null)).toBe(true);
  });

  it('el líder del proyecto puede', () => {
    expect(canCreateTaskUI(makeUser(LEADER_ID, ['PROJECT_LEADER']), project, null)).toBe(true);
  });

  it('líder de otro proyecto no puede', () => {
    expect(canCreateTaskUI(makeUser('otro-leader', ['PROJECT_LEADER']), project, null)).toBe(false);
  });

  it('COLLABORATOR con membership COLLABORATOR en este proyecto puede', () => {
    const user = makeUser('u1', ['COLLABORATOR']);
    expect(canCreateTaskUI(user, project, makeMembership('COLLABORATOR'))).toBe(true);
  });

  it('OBSERVER (rol global) no puede', () => {
    const user = makeUser('u1', ['OBSERVER']);
    expect(canCreateTaskUI(user, project, makeMembership('OBSERVER'))).toBe(false);
  });

  it('sin membership no puede', () => {
    expect(canCreateTaskUI(makeUser('ajeno', ['COLLABORATOR']), project, null)).toBe(false);
  });

  // Caso crítico: rol global COLLABORATOR pero projectRole local OBSERVER.
  it('COLLABORATOR global + membership OBSERVER en este proyecto -> false (no decide por el rol global)', () => {
    const user = makeUser('u1', ['COLLABORATOR']);
    expect(canCreateTaskUI(user, project, makeMembership('OBSERVER'))).toBe(false);
  });
});

describe('canEditTaskUI', () => {
  const project = makeProject();

  it('ADMIN y PROGRAM_MANAGER editan cualquier tarea', () => {
    const task = makeTask({ createdBy: 'otro', assignedToId: 'otro' });
    expect(canEditTaskUI(makeUser('admin-1', ['ADMIN']), task, project, null)).toBe(true);
    expect(canEditTaskUI(makeUser('pm-1', ['PROGRAM_MANAGER']), task, project, null)).toBe(true);
  });

  it('el líder del proyecto edita cualquier tarea del proyecto', () => {
    const task = makeTask({ createdBy: 'otro', assignedToId: 'otro' });
    expect(canEditTaskUI(makeUser(LEADER_ID, ['PROJECT_LEADER']), task, project, null)).toBe(true);
  });

  it('líder de OTRO proyecto no puede', () => {
    const task = makeTask();
    expect(canEditTaskUI(makeUser('otro-leader', ['PROJECT_LEADER']), task, project, null)).toBe(false);
  });

  it('COLLABORATOR: tarea creada por él, con membership COLLABORATOR -> true', () => {
    const user = makeUser('u1', ['COLLABORATOR']);
    const task = makeTask({ createdBy: 'u1' });
    expect(canEditTaskUI(user, task, project, makeMembership('COLLABORATOR'))).toBe(true);
  });

  it('COLLABORATOR: tarea asignada a él, con membership COLLABORATOR -> true', () => {
    const user = makeUser('u1', ['COLLABORATOR']);
    const task = makeTask({ assignedToId: 'u1' });
    expect(canEditTaskUI(user, task, project, makeMembership('COLLABORATOR'))).toBe(true);
  });

  it('COLLABORATOR: tarea ajena (ni creada ni asignada) -> false', () => {
    const user = makeUser('u1', ['COLLABORATOR']);
    const task = makeTask({ createdBy: 'otro', assignedToId: 'otro' });
    expect(canEditTaskUI(user, task, project, makeMembership('COLLABORATOR'))).toBe(false);
  });

  it('OBSERVER: siempre false, incluso sobre tarea propia/asignada', () => {
    const user = makeUser('u1', ['OBSERVER']);
    const task = makeTask({ createdBy: 'u1', assignedToId: 'u1' });
    expect(canEditTaskUI(user, task, project, makeMembership('OBSERVER'))).toBe(false);
  });

  // Caso crítico obligatorio (punto 11 de la HU).
  it('COLLABORATOR global + membership OBSERVER: false, aunque la tarea sea propia/asignada', () => {
    const user = makeUser('u1', ['COLLABORATOR']);
    const task = makeTask({ createdBy: 'u1', assignedToId: 'u1' });
    expect(canEditTaskUI(user, task, project, makeMembership('OBSERVER'))).toBe(false);
  });

  it('multi-rol ADMIN + PROGRAM_MANAGER conserva el permiso', () => {
    const task = makeTask({ createdBy: 'otro', assignedToId: 'otro' });
    const user = makeUser('u1', ['ADMIN', 'PROGRAM_MANAGER']);
    expect(canEditTaskUI(user, task, project, null)).toBe(true);
  });
});

describe('canDeleteTaskUI', () => {
  const project = makeProject();

  it('ADMIN, PROGRAM_MANAGER y el líder del proyecto pueden', () => {
    expect(canDeleteTaskUI(makeUser('admin-1', ['ADMIN']), project)).toBe(true);
    expect(canDeleteTaskUI(makeUser('pm-1', ['PROGRAM_MANAGER']), project)).toBe(true);
    expect(canDeleteTaskUI(makeUser(LEADER_ID, ['PROJECT_LEADER']), project)).toBe(true);
  });

  it('líder de otro proyecto no puede', () => {
    expect(canDeleteTaskUI(makeUser('otro-leader', ['PROJECT_LEADER']), project)).toBe(false);
  });

  it('COLLABORATOR nunca puede, ni siquiera con membership COLLABORATOR (a diferencia de editar)', () => {
    expect(canDeleteTaskUI(makeUser('u1', ['COLLABORATOR']), project)).toBe(false);
  });

  it('OBSERVER nunca puede', () => {
    expect(canDeleteTaskUI(makeUser('u1', ['OBSERVER']), project)).toBe(false);
  });
});

describe('Users: gestión de roles globales', () => {
  const TARGET_ID = 'target-1';

  describe('canViewUsersUI', () => {
    it('ADMIN y PROGRAM_MANAGER pueden', () => {
      expect(canViewUsersUI(makeUser('admin-1', ['ADMIN']))).toBe(true);
      expect(canViewUsersUI(makeUser('pm-1', ['PROGRAM_MANAGER']))).toBe(true);
    });

    it('PROJECT_LEADER, COLLABORATOR, OBSERVER no pueden', () => {
      expect(canViewUsersUI(makeUser('u1', ['PROJECT_LEADER']))).toBe(false);
      expect(canViewUsersUI(makeUser('u1', ['COLLABORATOR']))).toBe(false);
      expect(canViewUsersUI(makeUser('u1', ['OBSERVER']))).toBe(false);
    });
  });

  describe('canManageGlobalRolesUI (editor completo)', () => {
    it('ADMIN sobre otro usuario: true', () => {
      expect(canManageGlobalRolesUI(makeUser('admin-1', ['ADMIN']), TARGET_ID)).toBe(true);
    });

    it('ADMIN sobre sí mismo: false (RN-09)', () => {
      const admin = makeUser('admin-1', ['ADMIN']);
      expect(canManageGlobalRolesUI(admin, admin.id)).toBe(false);
    });

    it('PROGRAM_MANAGER: false (no tiene el editor completo)', () => {
      expect(canManageGlobalRolesUI(makeUser('pm-1', ['PROGRAM_MANAGER']), TARGET_ID)).toBe(false);
    });
  });

  describe('canAssignGlobalRoleUI / canAssignProjectLeaderRoleUI', () => {
    it('ADMIN puede asignar cualquier rol', () => {
      const admin = makeUser('admin-1', ['ADMIN']);
      expect(canAssignGlobalRoleUI(admin, TARGET_ID, 'ADMIN')).toBe(true);
      expect(canAssignGlobalRoleUI(admin, TARGET_ID, 'COLLABORATOR')).toBe(true);
    });

    it('PROGRAM_MANAGER solo puede asignar PROJECT_LEADER', () => {
      const pm = makeUser('pm-1', ['PROGRAM_MANAGER']);
      expect(canAssignGlobalRoleUI(pm, TARGET_ID, 'PROJECT_LEADER')).toBe(true);
      expect(canAssignProjectLeaderRoleUI(pm, TARGET_ID)).toBe(true);
    });

    it('PROGRAM_MANAGER no puede asignar ADMIN, PROGRAM_MANAGER, COLLABORATOR ni OBSERVER', () => {
      const pm = makeUser('pm-1', ['PROGRAM_MANAGER']);
      expect(canAssignGlobalRoleUI(pm, TARGET_ID, 'ADMIN')).toBe(false);
      expect(canAssignGlobalRoleUI(pm, TARGET_ID, 'PROGRAM_MANAGER')).toBe(false);
      expect(canAssignGlobalRoleUI(pm, TARGET_ID, 'COLLABORATOR')).toBe(false);
      expect(canAssignGlobalRoleUI(pm, TARGET_ID, 'OBSERVER')).toBe(false);
    });

    it('nadie puede asignarse roles a sí mismo, ni ADMIN', () => {
      const admin = makeUser('admin-1', ['ADMIN']);
      expect(canAssignGlobalRoleUI(admin, admin.id, 'PROJECT_LEADER')).toBe(false);
    });

    it('PROJECT_LEADER, COLLABORATOR, OBSERVER: false para cualquier rol', () => {
      expect(canAssignGlobalRoleUI(makeUser('u1', ['PROJECT_LEADER']), TARGET_ID, 'COLLABORATOR')).toBe(false);
      expect(canAssignGlobalRoleUI(makeUser('u1', ['COLLABORATOR']), TARGET_ID, 'OBSERVER')).toBe(false);
    });
  });

  describe('canRemoveGlobalRoleUI', () => {
    it('solo ADMIN, nunca PROGRAM_MANAGER (no está documentado como permitido)', () => {
      expect(canRemoveGlobalRoleUI(makeUser('admin-1', ['ADMIN']), TARGET_ID)).toBe(true);
      expect(canRemoveGlobalRoleUI(makeUser('pm-1', ['PROGRAM_MANAGER']), TARGET_ID)).toBe(false);
    });

    it('ADMIN no puede quitarse roles a sí mismo', () => {
      const admin = makeUser('admin-1', ['ADMIN']);
      expect(canRemoveGlobalRoleUI(admin, admin.id)).toBe(false);
    });
  });

  describe('canManageUserStatusUI', () => {
    it('ADMIN puede activar/desactivar a otro usuario', () => {
      expect(canManageUserStatusUI(makeUser('admin-1', ['ADMIN']), TARGET_ID)).toBe(true);
    });

    it('ADMIN no puede desactivarse a sí mismo', () => {
      const admin = makeUser('admin-1', ['ADMIN']);
      expect(canManageUserStatusUI(admin, admin.id)).toBe(false);
    });

    it('PROGRAM_MANAGER no puede', () => {
      expect(canManageUserStatusUI(makeUser('pm-1', ['PROGRAM_MANAGER']), TARGET_ID)).toBe(false);
    });
  });

  describe('multi-rol', () => {
    it('ADMIN + PROGRAM_MANAGER conserva el permiso de ADMIN', () => {
      const multi = makeUser('multi-1', ['PROGRAM_MANAGER', 'ADMIN']);
      expect(canManageGlobalRolesUI(multi, TARGET_ID)).toBe(true);
      expect(canAssignGlobalRoleUI(multi, TARGET_ID, 'COLLABORATOR')).toBe(true);
    });
  });
});
