import { describe, expect, it, vi } from 'vitest';
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
  it('identifica y muestra claramente los tres estados de tareas y excluye archivadas', () => {
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
  });
});
