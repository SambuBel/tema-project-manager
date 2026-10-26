import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Task } from '../types/task';
import { TaskList } from './TaskList';

const PROJECT_ID = 'p1';

const task = (overrides: Partial<Task> & { id: string; title: string }): Task =>
  ({
    projectId: PROJECT_ID,
    parentTaskId: null,
    description: null,
    status: 'PENDING',
    priority: 'MEDIUM',
    assignedToId: null,
    startDate: null,
    dueDate: '2026-11-28',
    createdBy: 'u1',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    archivedAt: null,
    project: { id: PROJECT_ID, name: 'P', leaderId: 'u1' },
    ...overrides,
  }) as Task;

/** TaskList con el cache sembrado (sin red; renderToString, sin jsdom). */
function render(tasks: Task[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['tasks', { projectId: PROJECT_ID, page: 1, limit: 10 }, 'ALL'], { data: tasks, total: tasks.length, page: 1, limit: 10, totalPages: 1, counts: { all: tasks.length, mine: 0, atRisk: 0 } });
  client.setQueryData(['project', PROJECT_ID], { id: PROJECT_ID, name: 'P', leaderId: 'u1' });
  client.setQueryData(['project-members', PROJECT_ID], []);
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskList projectId={PROJECT_ID} onSelectTask={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** El fragmento HTML de la fila (botón) de una tarea, para afirmar sobre esa fila y no sobre toda la lista. */
function row(html: string, title: string): string {
  const rows = html.split('<button').slice(1);
  const found = rows.find((r) => r.includes(`>${title}<`));
  if (!found) throw new Error(`No se encontró la fila de "${title}"`);
  return found;
}

const BADGE = '>Archivada<';

describe('TaskList - tareas archivadas', () => {
  it('1) tarea activa: no muestra el badge "Archivada"', () => {
    const html = render([task({ id: 'a', title: 'Tarea activa' })]);
    expect(html).toContain('Tarea activa');
    expect(html).not.toContain(BADGE);
  });

  it('2) tarea con archivedAt: muestra el badge "Archivada" junto al título', () => {
    const html = render([task({ id: 'a', title: 'Tarea de prueba 2', archivedAt: '2026-10-10T12:00:00Z' })]);
    expect(row(html, 'Tarea de prueba 2')).toContain(BADGE);
  });

  it('3) la archivada conserva su estado y su prioridad originales (Archivada no es un estado)', () => {
    const html = render([task({ id: 'a', title: 'Tarea de prueba 2', status: 'PENDING', priority: 'MEDIUM', archivedAt: '2026-10-10T12:00:00Z' })]);
    const archivada = row(html, 'Tarea de prueba 2');
    expect(archivada).toContain('>Pendiente<');
    expect(archivada).toContain('>Media<');
  });

  it.each([
    ['IN_PROGRESS', 'En curso'],
    ['COMPLETED', 'Completada'],
    ['BLOCKED', 'Bloqueada'],
  ] as const)('3b) archivada en estado %s sigue mostrando "%s"', (status, label) => {
    const archivada = row(render([task({ id: 'a', title: 'T', status, archivedAt: '2026-10-10T12:00:00Z' })]), 'T');
    expect(archivada).toContain(`>${label}<`);
    expect(archivada).toContain(BADGE);
  });

  it('4) lista mixta: solo las archivadas llevan el badge', () => {
    const html = render([
      task({ id: '1', title: 'Activa uno' }),
      task({ id: '2', title: 'Archivada uno', archivedAt: '2026-10-10T12:00:00Z' }),
      task({ id: '3', title: 'Activa dos', status: 'IN_PROGRESS' }),
      task({ id: '4', title: 'Archivada dos', status: 'COMPLETED', archivedAt: '2026-09-01T00:00:00Z' }),
    ]);
    expect(row(html, 'Activa uno')).not.toContain(BADGE);
    expect(row(html, 'Activa dos')).not.toContain(BADGE);
    expect(row(html, 'Archivada uno')).toContain(BADGE);
    expect(row(html, 'Archivada dos')).toContain(BADGE);
    expect(html.split(BADGE).length - 1).toBe(2); // exactamente dos badges en toda la lista
  });

  it('el badge no altera los conteos ni las demás columnas de las activas', () => {
    const html = render([task({ id: '1', title: 'Activa', status: 'IN_PROGRESS' }), task({ id: '2', title: 'Archivada', archivedAt: '2026-10-10T12:00:00Z' })]);
    expect(html).toContain('2 tareas');
    expect(row(html, 'Activa')).toContain('>En curso<');
  });
});
