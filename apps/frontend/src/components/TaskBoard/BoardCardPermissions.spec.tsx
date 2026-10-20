import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoardCard } from './BoardCard';
import * as useCurrentUserModule from '../../hooks/useCurrentUser';
import * as useMyMembershipModule from '../../hooks/useMyMembership';
import type { AuthenticatedUser, Project, ProjectMember, RoleName, Task } from '@tema/shared-types';

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(),
}));

vi.mock('../../hooks/useMyMembership', () => ({
  useMyMembership: vi.fn(),
}));

describe('BoardCard Permissions', () => {
  const PROJECT_ID = 'project-uuid-1';
  const LEADER_ID = 'leader-user-1';

  const mockProject: Project = {
    id: PROJECT_ID,
    slug: 'proyecto-slug-alpha',
    name: 'Proyecto Alpha',
    description: null,
    startDate: null,
    estimatedEndDate: null,
    status: 'IN_PROGRESS',
    leaderId: LEADER_ID,
    createdBy: LEADER_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  };

  const makeUser = (id: string, roles: RoleName[]): AuthenticatedUser => ({
    id,
    email: `${id}@tema.com`,
    name: id,
    avatarUrl: null,
    roles,
  });

  const makeMembership = (projectRole: ProjectMember['projectRole']): ProjectMember => ({
    id: 'mem-1',
    projectId: PROJECT_ID,
    userId: 'u1',
    projectRole,
    joinedAt: new Date().toISOString(),
  });

  const makeTask = (overrides: Partial<Task> = {}): Task => ({
    id: 'task-1',
    projectId: PROJECT_ID,
    parentTaskId: null,
    title: 'Tarea de prueba',
    description: null,
    status: 'PENDING',
    priority: 'MEDIUM',
    assignedToId: null,
    startDate: null,
    dueDate: null,
    createdBy: 'someone-else',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Prueba de regresión: acceso por slug con caché por ID vacía', () => {
    it('permite arrastrar a ADMIN cuando el proyecto se pasa por prop desde la URL con slug (sin entrada en caché por ID)', () => {
      (useCurrentUserModule.useCurrentUser as any).mockReturnValue({
        user: makeUser('admin-1', ['ADMIN']),
      });
      (useMyMembershipModule.useMyMembership as any).mockReturnValue({ membership: null });

      const task = makeTask({ createdBy: 'other-user', assignedToId: 'other-user' });
      // El proyecto se resolvió en ProjectPage por su slug y se inyecta vía props
      const element = BoardCard({
        task,
        index: 0,
        project: mockProject,
        onSelectTask: vi.fn(),
      }) as any;

      expect(element.props.isDragDisabled).toBe(false);
    });

    it('mantiene bloqueado a OBSERVER aunque el proyecto esté cargado por slug', () => {
      (useCurrentUserModule.useCurrentUser as any).mockReturnValue({
        user: makeUser('obs-1', ['OBSERVER']),
      });
      (useMyMembershipModule.useMyMembership as any).mockReturnValue({
        membership: makeMembership('OBSERVER'),
      });

      const task = makeTask({ createdBy: 'obs-1', assignedToId: 'obs-1' });
      const element = BoardCard({
        task,
        index: 0,
        project: mockProject,
        onSelectTask: vi.fn(),
      }) as any;

      expect(element.props.isDragDisabled).toBe(true);
    });
  });

  describe('Matriz de permisos con el helper real canEditTaskUI', () => {
    it('ADMIN puede arrastrar cualquier tarea', () => {
      (useCurrentUserModule.useCurrentUser as any).mockReturnValue({
        user: makeUser('admin-1', ['ADMIN']),
      });
      (useMyMembershipModule.useMyMembership as any).mockReturnValue({ membership: null });

      const element = BoardCard({
        task: makeTask({ createdBy: 'other', assignedToId: 'other' }),
        index: 0,
        project: mockProject,
        onSelectTask: vi.fn(),
      }) as any;

      expect(element.props.isDragDisabled).toBe(false);
    });

    it('PROGRAM_MANAGER puede arrastrar cualquier tarea', () => {
      (useCurrentUserModule.useCurrentUser as any).mockReturnValue({
        user: makeUser('pm-1', ['PROGRAM_MANAGER']),
      });
      (useMyMembershipModule.useMyMembership as any).mockReturnValue({ membership: null });

      const element = BoardCard({
        task: makeTask({ createdBy: 'other', assignedToId: 'other' }),
        index: 0,
        project: mockProject,
        onSelectTask: vi.fn(),
      }) as any;

      expect(element.props.isDragDisabled).toBe(false);
    });

    it('líder de su proyecto puede arrastrar cualquier tarea de su proyecto', () => {
      (useCurrentUserModule.useCurrentUser as any).mockReturnValue({
        user: makeUser(LEADER_ID, ['PROJECT_LEADER']),
      });
      (useMyMembershipModule.useMyMembership as any).mockReturnValue({ membership: null });

      const element = BoardCard({
        task: makeTask({ createdBy: 'other', assignedToId: 'other' }),
        index: 0,
        project: mockProject,
        onSelectTask: vi.fn(),
      }) as any;

      expect(element.props.isDragDisabled).toBe(false);
    });

    it('líder de OTRO proyecto queda bloqueado si no es ADMIN/PM ni miembro', () => {
      (useCurrentUserModule.useCurrentUser as any).mockReturnValue({
        user: makeUser('otro-leader', ['PROJECT_LEADER']),
      });
      (useMyMembershipModule.useMyMembership as any).mockReturnValue({ membership: null });

      const element = BoardCard({
        task: makeTask(),
        index: 0,
        project: mockProject,
        onSelectTask: vi.fn(),
      }) as any;

      expect(element.props.isDragDisabled).toBe(true);
    });

    it('colaborador con tarea propia puede arrastrar', () => {
      const collabId = 'collab-1';
      (useCurrentUserModule.useCurrentUser as any).mockReturnValue({
        user: makeUser(collabId, ['COLLABORATOR']),
      });
      (useMyMembershipModule.useMyMembership as any).mockReturnValue({
        membership: makeMembership('COLLABORATOR'),
      });

      const element = BoardCard({
        task: makeTask({ createdBy: collabId, assignedToId: 'other' }),
        index: 0,
        project: mockProject,
        onSelectTask: vi.fn(),
      }) as any;

      expect(element.props.isDragDisabled).toBe(false);
    });

    it('colaborador con tarea asignada puede arrastrar', () => {
      const collabId = 'collab-1';
      (useCurrentUserModule.useCurrentUser as any).mockReturnValue({
        user: makeUser(collabId, ['COLLABORATOR']),
      });
      (useMyMembershipModule.useMyMembership as any).mockReturnValue({
        membership: makeMembership('COLLABORATOR'),
      });

      const element = BoardCard({
        task: makeTask({ createdBy: 'other', assignedToId: collabId }),
        index: 0,
        project: mockProject,
        onSelectTask: vi.fn(),
      }) as any;

      expect(element.props.isDragDisabled).toBe(false);
    });

    it('colaborador con tarea ajena (ni creada ni asignada) queda bloqueado', () => {
      const collabId = 'collab-1';
      (useCurrentUserModule.useCurrentUser as any).mockReturnValue({
        user: makeUser(collabId, ['COLLABORATOR']),
      });
      (useMyMembershipModule.useMyMembership as any).mockReturnValue({
        membership: makeMembership('COLLABORATOR'),
      });

      const element = BoardCard({
        task: makeTask({ createdBy: 'other', assignedToId: 'other' }),
        index: 0,
        project: mockProject,
        onSelectTask: vi.fn(),
      }) as any;

      expect(element.props.isDragDisabled).toBe(true);
    });

    it('observador (membership OBSERVER) queda bloqueado incluso si la tarea es propia o asignada', () => {
      const obsId = 'obs-1';
      (useCurrentUserModule.useCurrentUser as any).mockReturnValue({
        user: makeUser(obsId, ['COLLABORATOR']),
      });
      (useMyMembershipModule.useMyMembership as any).mockReturnValue({
        membership: makeMembership('OBSERVER'),
      });

      const element = BoardCard({
        task: makeTask({ createdBy: obsId, assignedToId: obsId }),
        index: 0,
        project: mockProject,
        onSelectTask: vi.fn(),
      }) as any;

      expect(element.props.isDragDisabled).toBe(true);
    });
  });
});

