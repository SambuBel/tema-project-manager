import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MilestoneDetailDto } from '@tema/shared-types';
import { MilestoneDetailModal } from './MilestoneDetailModal';

const samplePendingDetail: MilestoneDetailDto = {
  id: 'm-100',
  projectId: 'proj-1',
  name: 'Lanzamiento v1.0',
  description: 'Entrega final con todas las funcionalidades.',
  dueDate: '2026-11-30',
  completedAt: null,
  completedById: null,
  createdBy: 'u-1',
  creator: { id: 'u-1', name: 'Líder Proyecto' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  status: 'PENDING',
  taskCount: 2,
  completedTaskCount: 1,
  progress: 50,
  tasks: [
    {
      id: 'task-101',
      title: 'Configurar servidor',
      status: 'COMPLETED',
      priority: 'HIGH',
      startDate: '2026-10-01',
      dueDate: '2026-10-15',
      parentTaskId: null,
      assignedTo: { id: 'u-2', name: 'Dev Ops' },
    },
    {
      id: 'task-102',
      title: 'Pruebas de carga',
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      startDate: '2026-10-16',
      dueDate: '2026-10-25',
      parentTaskId: null,
      assignedTo: { id: 'u-3', name: 'QA Tester' },
    },
  ],
};

const sampleCompletedDetail: MilestoneDetailDto = {
  ...samplePendingDetail,
  id: 'm-200',
  name: 'Hito Finalizado',
  status: 'COMPLETED',
  completedAt: '2026-10-15T12:00:00Z',
  completedBy: { id: 'u-1', name: 'Líder Proyecto' },
  completedTaskCount: 2,
  progress: 100,
};

function renderModal(detail: MilestoneDetailDto, canManage: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['milestone-detail', detail.id], detail);

  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MilestoneDetailModal
          isOpen={true}
          onClose={vi.fn()}
          milestoneId={detail.id}
          projectId="proj-1"
          canManage={canManage}
          onMilestoneUpdated={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MilestoneDetailModal (Detalle y Administración de Hito)', () => {
  it('renderiza datos del hito, tareas asociadas y progreso', () => {
    const html = renderModal(samplePendingDetail, true);
    expect(html).toContain('Lanzamiento v1.0');
    expect(html).toContain('Entrega final con todas las funcionalidades.');
    expect(html).toContain('Configurar servidor');
    expect(html).toContain('Pruebas de carga');
    expect(html).toContain('Dev Ops');
    expect(html).toContain('QA Tester');
    expect(html).toContain('50%');
  });

  it('cuando canManage=true en hito pendiente: muestra "Marcar como alcanzado", "Vincular tareas", "Editar", "Eliminar" y "Desasociar"', () => {
    const html = renderModal(samplePendingDetail, true);
    expect(html).toContain('Marcar como alcanzado');
    expect(html).toContain('Vincular tareas');
    expect(html).toContain('Editar hito');
    expect(html).toContain('Eliminar');
    expect(html).toContain('Desasociar');
  });

  it('cuando canManage=true en hito completado: muestra "Reabrir hito"', () => {
    const html = renderModal(sampleCompletedDetail, true);
    expect(html).toContain('Reabrir hito');
    expect(html).not.toContain('Marcar como alcanzado');
  });

  it('cuando canManage=false (solo lectura): NO muestra botones de administración', () => {
    const html = renderModal(samplePendingDetail, false);
    expect(html).not.toContain('Marcar como alcanzado');
    expect(html).not.toContain('Vincular tareas');
    expect(html).not.toContain('Editar hito');
    expect(html).not.toContain('Eliminar');
    expect(html).not.toContain('Desasociar');
    // Pero sí muestra la información y las tareas
    expect(html).toContain('Configurar servidor');
  });
});
