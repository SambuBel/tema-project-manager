import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MilestoneSummaryDto, Project } from '@tema/shared-types';
import { ProjectDetail } from './ProjectDetail';

const mockProject: Project = {
  id: 'proj-1',
  slug: 'proyecto-1',
  name: 'Proyecto 1',
  description: 'Descripción del proyecto',
  startDate: '2026-01-01',
  estimatedEndDate: '2026-12-31',
  status: 'IN_PROGRESS',
  leaderId: 'u-1',
  leader: { id: 'u-1', name: 'Líder', email: 'l@tema.com', avatarUrl: null, active: true },
  createdBy: 'u-1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  archivedAt: null,
  progress: 45,
  memberCount: 5,
};

const upcomingMilestonesSample: MilestoneSummaryDto[] = [
  {
    id: 'm-up-1',
    projectId: 'proj-1',
    name: 'Entrega Alfa',
    description: null,
    dueDate: '2026-11-10',
    completedAt: null,
    completedById: null,
    createdBy: 'u-1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    status: 'PENDING',
    taskCount: 5,
    completedTaskCount: 3,
    progress: 60,
  },
  {
    id: 'm-up-2',
    projectId: 'proj-1',
    name: 'Auditoría de Seguridad',
    description: null,
    dueDate: '2026-11-20',
    completedAt: null,
    completedById: null,
    createdBy: 'u-1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    status: 'OVERDUE',
    taskCount: 2,
    completedTaskCount: 0,
    progress: 0,
  },
];

function renderDetail(upcoming: MilestoneSummaryDto[] = upcomingMilestonesSample) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['milestones-upcoming', 'proj-1'], upcoming);

  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectDetail
          project={mockProject}
          onManageTeam={vi.fn()}
          onViewMilestones={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProjectDetail - Tarjeta «Próximos hitos» (KAN-246)', () => {
  it('muestra los próximos hitos reales con nombre, fecha, badge de estado y progreso', () => {
    const html = renderDetail(upcomingMilestonesSample);

    expect(html).toContain('Próximos hitos');
    expect(html).toContain('Entrega Alfa');
    expect(html).toContain('Auditoría de Seguridad');
    expect(html).toContain('Pendiente');
    expect(html).toContain('Vencido');
    expect(html).toContain('60%');
    expect(html).toContain('Ver todos los hitos');
  });

  it('muestra estado vacío útil cuando no hay próximos hitos sin inventar datos', () => {
    const html = renderDetail([]);

    expect(html).toContain('Próximos hitos');
    expect(html).toContain('No hay próximos hitos programados en este proyecto.');
    expect(html).toContain('Ir a la pestaña de Hitos');
    expect(html).not.toContain('Entrega Alfa');
  });

  it('conserva el resto del contenido del Resumen intacto', () => {
    const html = renderDetail(upcomingMilestonesSample);

    expect(html).toContain('Avance');
    expect(html).toContain('45%');
    expect(html).toContain('Entrega');
    expect(html).toContain('Equipo');
    expect(html).toContain('Objetivo del proyecto');
    expect(html).toContain('Descripción del proyecto');
  });
});
