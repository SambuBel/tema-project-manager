// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, ProjectMember, RoleName } from '@tema/shared-types';
import type { Task, TaskListResponse } from '../types/task';
import { TaskList } from './TaskList';

/** BUG-14, caso 3: el menú "Exportar…" de la lista sigue ExportService.checkExportPermission. */

const PROJECT_ID = 'project-1';
const LEADER_ID = 'leader-1';

const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({ id, email: `${id}@tema.com`, name: id, avatarUrl: null, roles });

const member = (userId: string, projectRole: ProjectMember['projectRole']) => ({
  id: `m-${userId}`,
  projectId: PROJECT_ID,
  userId,
  projectRole,
  joinedAt: '2026-10-01T00:00:00Z',
  user: { id: userId, name: userId, email: `${userId}@tema.com`, avatarUrl: null, active: true },
});

const TASK: Task = {
  id: 't1',
  slug: 't1',
  projectId: PROJECT_ID,
  parentTaskId: null,
  title: 'Tarea de prueba',
  description: null,
  status: 'PENDING',
  priority: 'MEDIUM',
  assignedToId: null,
  startDate: null,
  dueDate: '2026-12-15',
  createdBy: 'carla',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  archivedAt: null,
  project: { id: PROJECT_ID, name: 'Proyecto TEMA', leaderId: LEADER_ID, estimatedEndDate: '2026-12-31' },
};

function setup(actor: AuthenticatedUser, members: ReturnType<typeof member>[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['auth', 'me'], actor);
  client.setQueryData(['project', PROJECT_ID], {
    id: PROJECT_ID,
    slug: 'proyecto-tema',
    name: 'Proyecto TEMA',
    leaderId: LEADER_ID,
    leader: { id: LEADER_ID, name: 'Lucía', email: 'lucia@tema.com', avatarUrl: null, active: true },
    estimatedEndDate: '2026-12-31',
  });
  client.setQueryData(['project-members', PROJECT_ID], members);
  const page: TaskListResponse = { data: [TASK], total: 1, page: 1, limit: 10, totalPages: 1, counts: { all: 1, mine: 0, atRisk: 0 } };
  client.setQueryData(['tasks', { projectId: PROJECT_ID, page: 1, limit: 10 }, 'ALL'], page);

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskList projectId={PROJECT_ID} onSelectTask={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const exportMenu = () => screen.queryByRole('button', { name: /Exportar/ });

afterEach(cleanup);

describe('TaskList - menú Exportar (BUG-14)', () => {
  it.each([
    ['ADMIN', user('admin-1', ['ADMIN']), []],
    ['PROGRAM_MANAGER', user('pm-1', ['PROGRAM_MANAGER']), []],
    ['líder real del proyecto', user(LEADER_ID, ['PROJECT_LEADER']), []],
    ['COLLABORATOR local (exporta solo sus tareas, lo limita el backend)', user('carla', ['COLLABORATOR']), [member('carla', 'COLLABORATOR')]],
  ])('%s: lo ve', (_label, actor, members) => {
    setup(actor, members);
    expect(screen.getByText('Tarea de prueba')).toBeTruthy();
    expect(exportMenu()).not.toBeNull();
  });

  it('el colaborador ve las opciones CSV y PDF al abrir el menú', () => {
    setup(user('carla', ['COLLABORATOR']), [member('carla', 'COLLABORATOR')]);
    fireEvent.click(exportMenu()!);
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exportar PDF' })).toBeTruthy();
  });

  it.each([
    ['OBSERVER local (Olga)', user('olga', ['OBSERVER']), [member('olga', 'OBSERVER')]],
    ['COLLABORATOR global con rol local OBSERVER', user('carla', ['COLLABORATOR']), [member('carla', 'OBSERVER')]],
    ['usuario sin membresía en el proyecto', user('extrano', ['COLLABORATOR']), [member('otra-persona', 'COLLABORATOR')]],
    ['PROJECT_LEADER de otro proyecto, sin membresía', user('otro-lider', ['PROJECT_LEADER']), []],
  ])('%s: NO lo ve', (_label, actor, members) => {
    setup(actor, members);
    expect(screen.getByText('Tarea de prueba')).toBeTruthy();
    expect(exportMenu()).toBeNull();
  });
});
