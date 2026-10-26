import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GanttResponse, MilestoneSummaryDto } from '@tema/shared-types';

vi.mock('@svar-ui/react-gantt', () => ({
  Willow: ({ children }: { children: unknown }) => <div data-theme="willow">{children as never}</div>,
  Gantt: (props: Record<string, unknown>) => (
    <div
      data-gantt
      data-tasks={JSON.stringify(props.tasks)}
      data-links={JSON.stringify(props.links)}
    />
  ),
}));

import { ProjectGantt } from './ProjectGantt';

const ganttResponse: GanttResponse = {
  project: { id: 'p1', name: 'Proyecto Gantt', startDate: '2026-10-01', estimatedEndDate: '2026-12-31' },
  tasks: [
    {
      id: 't-1',
      parentTaskId: null,
      title: 'Arquitectura Base',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      startDate: '2026-10-05',
      dueDate: '2026-10-12',
      assignedTo: { id: 'u-1', name: 'Román' },
      blocked: false,
    },
  ],
  dependencies: [],
};

const sampleMilestones: MilestoneSummaryDto[] = [
  {
    id: 'm-1',
    projectId: 'p1',
    name: 'Hito 1 Alcanzado',
    description: 'Primera entrega completada',
    dueDate: '2026-10-15',
    completedAt: '2026-10-14T10:00:00Z',
    completedById: 'u-1',
    createdBy: 'u-1',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-14T10:00:00Z',
    status: 'COMPLETED',
    taskCount: 2,
    completedTaskCount: 2,
    progress: 100,
  },
  {
    id: 'm-2',
    projectId: 'p1',
    name: 'Hito 2 Pendiente',
    description: 'Entrega final del módulo',
    dueDate: '2026-11-20',
    completedAt: null,
    completedById: null,
    createdBy: 'u-1',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    status: 'PENDING',
    taskCount: 3,
    completedTaskCount: 1,
    progress: 33,
  },
];

describe('ProjectGantt — Integración con Milestones (KAN-280)', () => {
  it('incluye los hitos como marcadores type="milestone" en SVAR y renderiza el panel de hitos diferenciando pendientes y alcanzados', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['gantt', 'p1'], ganttResponse);
    client.setQueryData(['milestones', 'p1'], sampleMilestones);

    const html = renderToString(
      <QueryClientProvider client={client}>
        <ProjectGantt projectId="p1" />
      </QueryClientProvider>,
    );

    expect(html).toContain('Hitos en el cronograma (2)');
    expect(html).toContain('Hito 1 Alcanzado');
    expect(html).toContain('Hito 2 Pendiente');
    expect(html).toContain('data-milestone-status="COMPLETED"');
    expect(html).toContain('data-milestone-status="PENDING"');

    const rawTasks = /data-tasks="([^"]*)"/.exec(html)?.[1]?.replace(/&quot;/g, '"');
    expect(rawTasks).toBeDefined();
    const parsedTasks = JSON.parse(rawTasks!) as Array<{
      id: string;
      type: string;
      text: string;
      milestoneStatus?: string;
    }>;

    // 1 tarea original + 2 hitos
    expect(parsedTasks).toHaveLength(3);
    expect(parsedTasks[0]).toMatchObject({ id: 't-1', type: 'task', text: 'Arquitectura Base' });
    expect(parsedTasks[1]).toMatchObject({
      id: 'milestone:m-1',
      type: 'milestone',
      text: 'Hito 1 Alcanzado',
      milestoneStatus: 'COMPLETED',
    });
    expect(parsedTasks[2]).toMatchObject({
      id: 'milestone:m-2',
      type: 'milestone',
      text: 'Hito 2 Pendiente',
      milestoneStatus: 'PENDING',
    });
  });
});
