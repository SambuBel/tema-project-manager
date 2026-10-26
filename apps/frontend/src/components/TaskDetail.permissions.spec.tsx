import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, MilestoneSummaryDto, ProjectMember, RoleName } from '@tema/shared-types';
import { TaskDetail } from './TaskDetail';

const PROJECT_ID = 'project-1';
const TASK_ID = 'task-1';
const LEADER_ID = 'leader-1';
const COMMENT = 'Comentario existente de otro usuario';

const sampleMilestones: MilestoneSummaryDto[] = [
  {
    id: 'ms-1',
    projectId: PROJECT_ID,
    name: 'Entrega Sprint 1',
    description: null,
    dueDate: '2026-11-30',
    completedAt: null,
    completedById: null,
    createdBy: LEADER_ID,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    status: 'PENDING',
    taskCount: 2,
    completedTaskCount: 1,
    progress: 50,
  },
];

function user(id: string, roles: RoleName[]): AuthenticatedUser {
  return { id, email: `${id}@tema.com`, name: id, avatarUrl: null, roles };
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    parentTaskId: null,
    title: 'Tarea',
    description: null,
    status: 'PENDING', // con transiciones válidas: el dropdown sería interactivo
    priority: 'MEDIUM',
    assignedToId: null,
    startDate: null,
    dueDate: null,
    createdBy: 'otro',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    archivedAt: null,
    project: { id: PROJECT_ID, name: 'Proyecto', leaderId: LEADER_ID },
    ...overrides,
  };
}

function member(userId: string, projectRole: ProjectMember['projectRole']): ProjectMember {
  return { id: `m-${userId}`, projectId: PROJECT_ID, userId, projectRole, joinedAt: '' };
}

/**
 * Render de TaskDetail con el cache de React Query sembrado (sin red). renderToString porque
 * no hay jsdom/testing-library; alcanza para saber qué controles salen en el HTML.
 */
function render(currentUser: AuthenticatedUser, members: ProjectMember[], taskOverrides = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth', 'me'], currentUser);
  client.setQueryData(['task', TASK_ID], task(taskOverrides));
  client.setQueryData(['project-members', PROJECT_ID], members);
  client.setQueryData(['milestones', PROJECT_ID], sampleMilestones);
  client.setQueryData(['subtasks', TASK_ID], []);
  client.setQueryData(['task', TASK_ID, 'timeline', 1], { data: [
    {
      id: 'c1',
      type: 'COMMENT',
      content: COMMENT,
      actor: { id: 'x', name: 'Ana Gómez', avatar: 'AG' },
      createdAt: new Date().toISOString(),
    },
  ], total: 1, page: 1, limit: 10, totalPages: 1 });
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskDetail taskId={TASK_ID} onBack={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const hasComposer = (html: string) => html.includes('<textarea');
/** El dropdown interactivo es un <button> con la flecha ▾; el modo solo lectura es un <span>. */
const hasInteractiveStatus = (html: string) => /<button[^>]*>[^<]*Pendiente<span[^>]*>▾<\/span>/.test(html);

describe('TaskDetail - comentarios y cambio de estado según permisos', () => {
  describe.each([
    ['ADMIN', user('admin-1', ['ADMIN']), []],
    ['PROGRAM_MANAGER', user('pm-1', ['PROGRAM_MANAGER']), []],
    ['líder real', user(LEADER_ID, ['PROJECT_LEADER']), []],
  ])('%s', (_label, actor, members) => {
    it('puede comentar y cambiar estado (sobre tarea ajena)', () => {
      const html = render(actor, members);
      expect(hasComposer(html)).toBe(true);
      expect(hasInteractiveStatus(html)).toBe(true);
    });

    it('puede gestionar el hito asociado desde el detalle de la tarea (KAN-247)', () => {
      const html = render(actor, members, { milestoneId: 'ms-1' });
      expect(html).toContain('Entrega Sprint 1');
      expect(html).toContain('id="task-detail-milestone-select"');
      expect(html).toContain('Desasociar del hito');
    });
  });

  describe('COLLABORATOR con rol local COLLABORATOR', () => {
    const collab = user('collab-1', ['COLLABORATOR']);
    const members = [member('collab-1', 'COLLABORATOR')];

    it('tarea propia: puede comentar y cambiar estado, pero NO ve el selector para cambiar el hito (KAN-247)', () => {
      const html = render(collab, members, { createdBy: 'collab-1', milestoneId: 'ms-1' });
      expect(hasComposer(html)).toBe(true);
      expect(hasInteractiveStatus(html)).toBe(true);
      // Ve el hito asociado en modo lectura, pero sin controles de modificación
      expect(html).toContain('Entrega Sprint 1');
      expect(html).not.toContain('id="task-detail-milestone-select"');
      expect(html).not.toContain('Desasociar del hito');
    });

    it('tarea asignada: puede comentar y cambiar estado', () => {
      const html = render(collab, members, { assignedToId: 'collab-1' });
      expect(hasComposer(html)).toBe(true);
      expect(hasInteractiveStatus(html)).toBe(true);
    });

    it('tarea ajena: puede comentar, pero NO cambiar estado (ve solo el badge)', () => {
      const html = render(collab, members);
      expect(hasComposer(html)).toBe(true);
      expect(hasInteractiveStatus(html)).toBe(false);
      expect(html).toContain('Pendiente');
    });
  });

  describe.each([
    ['OBSERVER local', user('obs-1', ['OBSERVER']), [member('obs-1', 'OBSERVER')]],
    ['COLLABORATOR global con rol local OBSERVER', user('collab-1', ['COLLABORATOR']), [member('collab-1', 'OBSERVER')]],
  ])('%s', (_label, actor, members) => {
    it('lee los comentarios existentes pero no ve composer ni dropdown de estado, ni sobre tarea propia', () => {
      const html = render(actor, members, { createdBy: actor.id, assignedToId: actor.id });
      expect(html).toContain(COMMENT);
      expect(hasComposer(html)).toBe(false);
      expect(html).not.toContain('>Comentar<'); // el botón de enviar
      expect(hasInteractiveStatus(html)).toBe(false);
      expect(html).toContain('Pendiente'); // el estado actual se sigue mostrando como badge
    });
  });

  it('el composer se oculta (no se deshabilita): no hay ningún textarea ni botón de enviar', () => {
    const html = render(user('obs-1', ['OBSERVER']), [member('obs-1', 'OBSERVER')]);
    expect(html).not.toContain('Escribí un comentario');
    expect(html).not.toContain('type="submit"');
  });

  it('oculta la sección de hito cuando se visualiza una subtarea (parentTaskId !== null)', () => {
    const html = render(user('admin-1', ['ADMIN']), [], {
      parentTaskId: 'parent-root-1',
      milestoneId: 'ms-1',
    });
    expect(html).not.toContain('id="task-detail-milestone-select"');
    expect(html).not.toContain('Desasociar del hito');
  });
});
