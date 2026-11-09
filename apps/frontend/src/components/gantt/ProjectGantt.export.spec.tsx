import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, GanttResponse } from '@tema/shared-types';

vi.mock('@svar-ui/react-gantt', () => ({
  Willow: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  Gantt: () => <div data-gantt />,
}));

import { ProjectGantt } from './ProjectGantt';

/**
 * BUG-14 NO toca la exportación del Gantt: el backend la permite a quien puede ver el proyecto (incluido el
 * observador), así que el menú sigue apareciendo sin depender de canExportTasksUI. Si una regla distinta se decide
 * más adelante, se trata como bug aparte.
 */
const data: GanttResponse = {
  project: { id: 'p1', name: 'Alfa', startDate: null, estimatedEndDate: null },
  tasks: [
    {
      id: 'A',
      parentTaskId: null,
      title: 'Diseño',
      status: 'PENDING',
      priority: 'MEDIUM',
      startDate: '2026-10-10',
      dueDate: '2026-10-14',
      assignedTo: null,
      blocked: false,
    },
  ],
  dependencies: [],
};

function renderAs(me: AuthenticatedUser | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  client.setQueryData(['gantt', 'p1'], data);
  if (me) client.setQueryData(['auth', 'me'], me);
  return renderToString(
    <QueryClientProvider client={client}>
      <ProjectGantt projectId="p1" />
    </QueryClientProvider>,
  );
}

describe('ProjectGantt - exportación (sin cambios por BUG-14)', () => {
  it('un observador sigue viendo el menú Exportar del Gantt', () => {
    const observer: AuthenticatedUser = { id: 'olga', email: 'olga@tema.test', name: 'Olga', avatarUrl: null, roles: ['OBSERVER'] };
    expect(renderAs(observer)).toContain('Exportar…');
  });

  it('un colaborador también', () => {
    const collab: AuthenticatedUser = { id: 'carla', email: 'carla@tema.test', name: 'Carla', avatarUrl: null, roles: ['COLLABORATOR'] };
    expect(renderAs(collab)).toContain('Exportar…');
  });
});
