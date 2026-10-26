import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, MilestoneSummaryDto, Project, RoleName, Task } from '@tema/shared-types';
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

const sampleMilestones: MilestoneSummaryDto[] = [
  {
    id: 'ms-1',
    projectId: PROJECT_ID,
    name: 'Hito Alpha',
    description: null,
    dueDate: '2026-11-15',
    completedAt: null,
    completedById: null,
    createdBy: LEADER_ID,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    status: 'PENDING',
    taskCount: 1,
    completedTaskCount: 0,
    progress: 0,
  },
];

function user(id: string, roles: RoleName[]): AuthenticatedUser {
  return { id, email: `${id}@tema.com`, name: id, avatarUrl: null, roles };
}

/**
 * Render del form en modo edición con el cache de React Query ya sembrado (sin red). Usa
 * renderToString porque no hay jsdom/testing-library en el frontend; alcanza para verificar
 * qué inputs salen deshabilitados.
 */
function renderEdit(currentUser: AuthenticatedUser | null, taskOverrides: Partial<Task> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (currentUser) client.setQueryData(['auth', 'me'], currentUser);
  client.setQueryData(['project', PROJECT_ID], project);
  client.setQueryData(['project-members', PROJECT_ID], []);
  client.setQueryData(['milestones', PROJECT_ID], sampleMilestones);
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskForm projectId={PROJECT_ID} initialData={{ ...task, ...taskOverrides }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** ¿El <input id="..."> tiene el atributo disabled? */
function isDisabled(html: string, id: string): boolean {
  const input = html.match(new RegExp(`<(?:input|select)[^>]*id="${id}"[^>]*>`))?.[0];
  if (!input) throw new Error(`No se encontró el control ${id}`);
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

describe('TaskForm - Selección de Milestone según canManageMilestonesUI (KAN-247)', () => {
  it.each([
    ['ADMIN', user('admin-1', ['ADMIN'])],
    ['PROGRAM_MANAGER', user('pm-1', ['PROGRAM_MANAGER'])],
    ['líder real', user(LEADER_ID, ['PROJECT_LEADER'])],
  ])('%s: selector de hito habilitado y lista los hitos activos del proyecto', (_label, actor) => {
    const html = renderEdit(actor, { milestoneId: 'ms-1' });
    expect(isDisabled(html, 'task-milestone')).toBe(false);
    expect(html).toContain('Sin hito asignado');
    expect(html).toContain('Hito Alpha');
  });

  it.each([
    ['COLLABORATOR', user('collab-1', ['COLLABORATOR'])],
    ['PROJECT_LEADER ajeno', user('otro-leader', ['PROJECT_LEADER'])],
    ['OBSERVER', user('obs-1', ['OBSERVER'])],
  ])('%s: selector de hito deshabilitado', (_label, actor) => {
    const html = renderEdit(actor);
    expect(isDisabled(html, 'task-milestone')).toBe(true);
    expect(html).toContain('asociar o modificar el hito');
  });

  it('oculta el selector de hito cuando la tarea es una subtarea (parentTaskId !== null)', () => {
    const html = renderEdit(user('admin-1', ['ADMIN']), { parentTaskId: 'parent-root-1' });
    expect(html).not.toContain('id="task-milestone"');
  });
});

describe('TaskForm - RN-17 y RN-08', () => {
  it('RN-17: deshabilita el guardado y muestra error si la fecha de vencimiento es anterior al inicio', () => {
    const invalidTask = {
      ...task,
      startDate: '2026-10-25',
      dueDate: '2026-10-10',
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], user('admin-1', ['ADMIN']));
    client.setQueryData(['project', PROJECT_ID], project);
    client.setQueryData(['project-members', PROJECT_ID], []);

    const html = renderToString(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TaskForm projectId={PROJECT_ID} initialData={invalidTask} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('La fecha de vencimiento no puede ser anterior a la de inicio.');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*\sdisabled(=|\s|>)/);
  });

  it('RN-08: permite enviar (botón no deshabilitado) cuando el vencimiento supera el fin estimado del proyecto', () => {
    const taskExceedingProject = {
      ...task,
      startDate: '2026-10-10',
      dueDate: '2026-11-15',
    };
    const projectWithEnd = {
      ...project,
      estimatedEndDate: '2026-10-31',
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], user('admin-1', ['ADMIN']));
    client.setQueryData(['project', PROJECT_ID], projectWithEnd);
    client.setQueryData(['project-members', PROJECT_ID], []);

    const html = renderToString(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TaskForm projectId={PROJECT_ID} initialData={taskExceedingProject} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // RN-08 no bloquea la acción: el botón de submit NO está deshabilitado
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*\sdisabled(=|\s|>)/);
    expect(html).not.toContain('La fecha de vencimiento no puede ser anterior a la de inicio.');
  });
});
