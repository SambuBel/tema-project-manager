import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, Project, RoleName, Task } from '@tema/shared-types';
import { TaskForm } from './TaskForm';

const PROJECT_ID = 'project-1';
const LEADER_ID = 'leader-1';

const project = {
  id: PROJECT_ID,
  name: 'Proyecto',
  leaderId: LEADER_ID,
  leader: { id: LEADER_ID, name: 'Líder' },
} as unknown as Project;

const task = {
  id: 'task-1',
  projectId: PROJECT_ID,
  parentTaskId: null,
  title: 'Tarea',
  description: null,
  status: 'PENDING',
  priority: 'MEDIUM',
  assignedToId: null,
  startDate: '2026-10-10',
  dueDate: '2026-10-20',
  createdBy: 'collab-1',
} as unknown as Task;

function user(id: string, roles: RoleName[]): AuthenticatedUser {
  return { id, email: `${id}@tema.com`, name: id, avatarUrl: null, roles };
}

/**
 * Render del form en modo edición con el cache de React Query ya sembrado (sin red). Usa
 * renderToString porque no hay jsdom/testing-library en el frontend; alcanza para verificar
 * qué inputs salen deshabilitados.
 */
function renderEdit(currentUser: AuthenticatedUser | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (currentUser) client.setQueryData(['auth', 'me'], currentUser);
  client.setQueryData(['project', PROJECT_ID], project);
  client.setQueryData(['project-members', PROJECT_ID], []);
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskForm projectId={PROJECT_ID} initialData={task} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** ¿El <input id="..."> tiene el atributo disabled? */
function isDisabled(html: string, id: string): boolean {
  const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
  if (!input) throw new Error(`No se encontró el input ${id}`);
  return /\sdisabled(=|\s|>)/.test(input);
}

describe('TaskForm (edición) - fechas según permiso de planificación', () => {
  it.each([
    ['ADMIN', user('admin-1', ['ADMIN'])],
    ['PROGRAM_MANAGER', user('pm-1', ['PROGRAM_MANAGER'])],
    ['líder real', user(LEADER_ID, ['PROJECT_LEADER'])],
  ])('%s: fechas editables', (_label, actor) => {
    const html = renderEdit(actor);
    expect(isDisabled(html, 'task-start')).toBe(false);
    expect(isDisabled(html, 'task-due')).toBe(false);
    expect(html).not.toContain('pueden cambiar las fechas');
  });

  it.each([
    ['COLLABORATOR', user('collab-1', ['COLLABORATOR'])],
    ['PROJECT_LEADER ajeno', user('otro-leader', ['PROJECT_LEADER'])],
    ['OBSERVER', user('obs-1', ['OBSERVER'])],
  ])('%s: fechas deshabilitadas y con aviso', (_label, actor) => {
    const html = renderEdit(actor);
    expect(isDisabled(html, 'task-start')).toBe(true);
    expect(isDisabled(html, 'task-due')).toBe(true);
    expect(html).toContain('pueden cambiar las fechas');
  });

  it('sin usuario cargado todavía: falla cerrado (fechas deshabilitadas)', () => {
    const html = renderEdit(null);
    expect(isDisabled(html, 'task-start')).toBe(true);
    expect(isDisabled(html, 'task-due')).toBe(true);
  });

  it('el resto de los campos sigue editable para el COLLABORATOR', () => {
    const html = renderEdit(user('collab-1', ['COLLABORATOR']));
    expect(html).toMatch(/<input[^>]*id="task-title"(?![^>]*disabled)[^>]*>/);
  });
});
