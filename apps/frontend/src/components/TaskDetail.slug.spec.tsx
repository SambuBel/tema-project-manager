import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@tema/shared-types';
import { TaskDetail } from './TaskDetail';

const PROJECT_ID = 'project-1';
const TASK_ID = 'task-uuid-1';
const SLUG = 'tarea-de-ejemplo';

function makeTask(overrides = {}) {
  return {
    id: TASK_ID,
    slug: SLUG,
    projectId: PROJECT_ID,
    parentTaskId: null,
    title: 'Tarea de ejemplo',
    description: null,
    status: 'PENDING',
    priority: 'MEDIUM',
    assignedToId: null,
    startDate: null,
    dueDate: null,
    createdBy: 'user-1',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    archivedAt: null,
    project: { id: PROJECT_ID, name: 'Proyecto', leaderId: 'user-1' },
    ...overrides,
  };
}

const currentUser: AuthenticatedUser = {
  id: 'user-1',
  email: 'u@tema.com',
  name: 'User 1',
  avatarUrl: null,
  roles: ['PROJECT_LEADER'],
};

describe('TaskDetail - soporte de URLs legibles con slug', () => {
  it('renderiza correctamente el detalle de la tarea cuando se busca por slug', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], currentUser);
    client.setQueryData(['task', SLUG], makeTask());
    client.setQueryData(['project-members', PROJECT_ID], []);
    client.setQueryData(['subtasks', TASK_ID], []);
    client.setQueryData(['task', TASK_ID, 'timeline'], []);

    const html = renderToString(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}?task=${SLUG}`]}>
          <TaskDetail taskId={SLUG} projectId={PROJECT_ID} onBack={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Tarea de ejemplo');
    expect(html).not.toContain('Cargando tarea');
    expect(html).not.toContain('Error al cargar');
  });

  it('renderiza correctamente el detalle cuando se busca por UUID histórico', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], currentUser);
    client.setQueryData(['task', TASK_ID], makeTask());
    client.setQueryData(['project-members', PROJECT_ID], []);
    client.setQueryData(['subtasks', TASK_ID], []);
    client.setQueryData(['task', TASK_ID, 'timeline'], []);

    const html = renderToString(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}?taskId=${TASK_ID}`]}>
          <TaskDetail taskId={TASK_ID} projectId={PROJECT_ID} onBack={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Tarea de ejemplo');
  });

  it('preserva el contexto de vista (tablero) cuando se abre el detalle con slug', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], currentUser);
    client.setQueryData(['task', SLUG], makeTask());
    client.setQueryData(['project-members', PROJECT_ID], []);
    client.setQueryData(['subtasks', TASK_ID], []);
    client.setQueryData(['task', TASK_ID, 'timeline'], []);

    const html = renderToString(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}?view=tablero&task=${SLUG}`]}>
          <TaskDetail taskId={SLUG} projectId={PROJECT_ID} onBack={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Tarea de ejemplo');
    expect(html).toContain('Volver a tareas');
  });

  it('preserva el contexto de vista (lista de tareas) cuando se abre el detalle con slug', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], currentUser);
    client.setQueryData(['task', SLUG], makeTask());
    client.setQueryData(['project-members', PROJECT_ID], []);
    client.setQueryData(['subtasks', TASK_ID], []);
    client.setQueryData(['task', TASK_ID, 'timeline'], []);

    const html = renderToString(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}?view=tasks&task=${SLUG}`]}>
          <TaskDetail taskId={SLUG} projectId={PROJECT_ID} onBack={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Tarea de ejemplo');
    expect(html).toContain('Volver a tareas');
  });
});
