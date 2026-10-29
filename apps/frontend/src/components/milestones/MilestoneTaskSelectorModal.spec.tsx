// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '../../lib/api';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MilestoneSummaryDto } from '@tema/shared-types';
import type { Task } from '../../types/task';
import { MilestoneTaskSelectorModal } from './MilestoneTaskSelectorModal';

const currentMilestone: MilestoneSummaryDto = {
  id: 'm-current',
  projectId: 'proj-1',
  name: 'Hito Actual',
  description: null,
  dueDate: '2026-11-20',
  completedAt: null,
  completedById: null,
  createdBy: 'u-1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  status: 'PENDING',
  taskCount: 1,
  completedTaskCount: 0,
  progress: 0,
};

const otherMilestone: MilestoneSummaryDto = {
  id: 'm-other',
  projectId: 'proj-1',
  name: 'Hito Beta',
  description: null,
  dueDate: '2026-12-01',
  completedAt: null,
  completedById: null,
  createdBy: 'u-1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  status: 'PENDING',
  taskCount: 1,
  completedTaskCount: 0,
  progress: 0,
};

const tasksList: Task[] = [
  {
    id: 't-1',
    projectId: 'proj-1',
    parentTaskId: null,
    milestoneId: 'm-current',
    title: 'Tarea ya vinculada',
    description: null,
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    assignedToId: 'u-1',
    project: { id: 'proj-1', name: 'Proyecto 1', leaderId: 'u-1' },
    startDate: '2026-10-01',
    dueDate: '2026-10-20',
    createdBy: 'u-1',
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    archivedAt: null,
  },
  {
    id: 't-2',
    projectId: 'proj-1',
    parentTaskId: null,
    milestoneId: 'm-other',
    title: 'Tarea en otro hito',
    description: null,
    status: 'PENDING',
    priority: 'MEDIUM',
    assignedToId: 'u-1',
    project: { id: 'proj-1', name: 'Proyecto 1', leaderId: 'u-1' },
    startDate: '2026-10-01',
    dueDate: '2026-10-25',
    createdBy: 'u-1',
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    archivedAt: null,
  },
  {
    id: 't-3',
    projectId: 'proj-1',
    parentTaskId: null,
    milestoneId: null,
    title: 'Tarea disponible para asociar',
    description: null,
    status: 'PENDING',
    priority: 'LOW',
    assignedToId: 'u-1',
    project: { id: 'proj-1', name: 'Proyecto 1', leaderId: 'u-1' },
    startDate: '2026-10-01',
    dueDate: '2026-10-30',
    createdBy: 'u-1',
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    archivedAt: null,
  },
  {
    id: 't-archived',
    projectId: 'proj-1',
    parentTaskId: null,
    milestoneId: null,
    title: 'Tarea archivada excluida',
    description: null,
    status: 'COMPLETED',
    priority: 'LOW',
    assignedToId: 'u-1',
    project: { id: 'proj-1', name: 'Proyecto 1', leaderId: 'u-1' },
    startDate: '2026-09-01',
    dueDate: '2026-09-10',
    createdBy: 'u-1',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-10',
    archivedAt: '2026-09-15T00:00:00Z',
  },
  {
    id: 't-subtask',
    projectId: 'proj-1',
    parentTaskId: 't-1',
    milestoneId: null,
    title: 'Subtarea disponible',
    description: null,
    status: 'PENDING',
    priority: 'LOW',
    assignedToId: 'u-1',
    project: { id: 'proj-1', name: 'Proyecto 1', leaderId: 'u-1' },
    startDate: '2026-10-01',
    dueDate: '2026-10-10',
    createdBy: 'u-1',
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    archivedAt: null,
  },
];

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['all-tasks-for-milestone', 'proj-1'], tasksList);
  client.setQueryData(['milestones-lookup', 'proj-1'], [currentMilestone, otherMilestone]);

  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MilestoneTaskSelectorModal
          isOpen={true}
          onClose={vi.fn()}
          milestone={currentMilestone}
          onTaskAssociated={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MilestoneTaskSelectorModal (KAN-245 & KAN-246)', () => {
  it('identifica y muestra claramente los tres estados de tareas principales e incluye subtareas activas', () => {
    const html = renderModal();

    // 1. Tarea ya asociada a este hito
    expect(html).toContain('Tarea ya vinculada');
    expect(html).toContain('✓ Vinculada');

    // 2. Tarea asociada a otro hito (D2 - No reasignable automáticamente)
    expect(html).toContain('Tarea en otro hito');
    expect(html).toContain('En: Hito Beta');
    expect(html).toContain('No reasignable');

    // 3. Tarea libre disponible
    expect(html).toContain('Tarea disponible para asociar');
    expect(html).toContain('+ Asociar');

    // 4. Tarea archivada excluida
    expect(html).not.toContain('Tarea archivada excluida');

    // 5. Subtarea (parentTaskId !== null) excluida del selector de hitos
    expect(html).not.toContain('Subtarea excluida del selector');
  });
});


afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderInteractiveSelector() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['milestones-lookup', 'proj-1'], [currentMilestone, otherMilestone]);
  const list = vi.spyOn(api, 'listAllTasks').mockResolvedValue(tasksList);
  const associated = vi.spyOn(api, 'associateMilestoneTask').mockResolvedValue(currentMilestone);
  render(<QueryClientProvider client={client}>
    <MilestoneTaskSelectorModal isOpen onClose={vi.fn()} milestone={currentMilestone} onTaskAssociated={vi.fn()} />
  </QueryClientProvider>);
  return { list, associated };
}

it('filtra Todas, Solo tareas y Solo subtareas y combina el filtro con búsqueda por tarea principal', async () => {
  const { list } = renderInteractiveSelector();
  await screen.findByText('Subtarea disponible');
  expect(list).toHaveBeenCalledWith({ projectId: 'proj-1', includeSubtasks: true });
  const filter = screen.getByRole('combobox', { name: 'Tipo de elemento' });
  fireEvent.change(filter, { target: { value: 'tasks' } });
  expect(screen.queryByText('Subtarea disponible')).toBeNull();
  expect(screen.getByText('Tarea disponible para asociar')).toBeTruthy();
  fireEvent.change(filter, { target: { value: 'subtasks' } });
  expect(screen.getByText('Subtarea disponible')).toBeTruthy();
  expect(screen.queryByText('Tarea disponible para asociar')).toBeNull();
  expect(screen.getByText('Tarea principal: Tarea ya vinculada')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ya vinculada' } });
  expect(screen.getByText('Subtarea disponible')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'inexistente' } });
  expect(screen.queryByText('Subtarea disponible')).toBeNull();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
  fireEvent.change(filter, { target: { value: 'all' } });
  expect(screen.getByText('Subtarea disponible')).toBeTruthy();
  expect(screen.getByText('Tarea disponible para asociar')).toBeTruthy();
  expect(screen.queryByText('Tarea archivada excluida')).toBeNull();
});

it.each([['Tarea disponible para asociar', 't-3'], ['Subtarea disponible', 't-subtask']])(
  'vincula %s sin vincular su tarea principal', async (title, id) => {
    const { associated } = renderInteractiveSelector();
    const text = await screen.findByText(title);
    const row = text.closest('div.min-w-0')!.parentElement!;
    fireEvent.click(within(row).getByRole('button', { name: '+ Asociar' }));
    await waitFor(() => expect(associated).toHaveBeenCalledWith('m-current', id));
    expect(associated).toHaveBeenCalledTimes(1);
  },
);
