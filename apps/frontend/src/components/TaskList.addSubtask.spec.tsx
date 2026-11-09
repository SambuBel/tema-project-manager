// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, ProjectMember, RoleName } from '@tema/shared-types';
import type { Task, TaskListResponse } from '../types/task';
import { TaskList } from './TaskList';

/** BUG-07: "+ Subtarea" por fila solo si el usuario puede EDITAR esa tarea y está abierta. */

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

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    slug: overrides.id,
    projectId: PROJECT_ID,
    parentTaskId: null,
    description: null,
    status: 'PENDING',
    priority: 'MEDIUM',
    assignedToId: null,
    startDate: null,
    dueDate: '2026-12-15',
    createdBy: 'camilo',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    archivedAt: null,
    project: { id: PROJECT_ID, name: 'Proyecto TEMA', leaderId: LEADER_ID, estimatedEndDate: '2026-12-31' },
    ...overrides,
  };
}

const TASKS: Task[] = [
  makeTask({ id: 't-own', title: 'Tarea propia', createdBy: 'carla' }),
  makeTask({ id: 't-assigned', title: 'Tarea asignada', createdBy: 'camilo', assignedToId: 'carla' }),
  makeTask({ id: 't-foreign', title: 'Tarea ajena', createdBy: 'camilo' }),
  makeTask({ id: 't-done', title: 'Tarea propia completada', createdBy: 'carla', status: 'COMPLETED' }),
  makeTask({ id: 't-archived', title: 'Tarea propia archivada', createdBy: 'carla', archivedAt: '2026-10-05T00:00:00Z' }),
];

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
  const page: TaskListResponse = {
    data: TASKS,
    total: TASKS.length,
    page: 1,
    limit: 10,
    totalPages: 1,
    counts: { all: TASKS.length, mine: 0, atRisk: 0 },
  };
  client.setQueryData(['tasks', { projectId: PROJECT_ID, page: 1, limit: 10 }, 'ALL'], page);

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskList projectId={PROJECT_ID} onSelectTask={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const addButton = (title: string) => screen.queryByRole('button', { name: `Agregar subtarea a ${title}` });

afterEach(() => cleanup());

describe('TaskList - "+ Subtarea" por fila (BUG-07)', () => {
  it('colaborador: solo en las tareas que creó o tiene asignadas y que están abiertas', () => {
    setup(user('carla', ['COLLABORATOR']), [member('carla', 'COLLABORATOR')]);

    // Las cinco filas se muestran: lo que cambia es el botón.
    for (const t of TASKS) expect(screen.getByText(t.title)).toBeTruthy();

    expect(addButton('Tarea propia')).not.toBeNull();
    expect(addButton('Tarea asignada')).not.toBeNull();
    expect(addButton('Tarea ajena')).toBeNull();
    expect(addButton('Tarea propia completada')).toBeNull();
    expect(addButton('Tarea propia archivada')).toBeNull();
  });

  it('líder real: en todas las tareas abiertas, sean de quien sean; no en completadas ni archivadas', () => {
    setup(user(LEADER_ID, ['PROJECT_LEADER']), []);

    expect(addButton('Tarea propia')).not.toBeNull();
    expect(addButton('Tarea asignada')).not.toBeNull();
    expect(addButton('Tarea ajena')).not.toBeNull();
    expect(addButton('Tarea propia completada')).toBeNull();
    expect(addButton('Tarea propia archivada')).toBeNull();
  });

  it('observador: no ve ningún botón, ni sobre una tarea que figura como creada por él', () => {
    setup(user('carla', ['COLLABORATOR']), [member('carla', 'OBSERVER')]);

    for (const t of TASKS) expect(addButton(t.title)).toBeNull();
  });
});
