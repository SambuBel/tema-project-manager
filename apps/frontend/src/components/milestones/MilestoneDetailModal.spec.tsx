// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../lib/api';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, MilestoneDetailDto, Project, ProjectMember } from '@tema/shared-types';
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
      assignedToId: 'u-2',
      createdBy: 'u-1',
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
      assignedToId: 'u-3',
      createdBy: 'u-1',
      subtaskCount: 3,
      completedSubtaskCount: 2,
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

function renderModal(
  detail: MilestoneDetailDto,
  canManage: boolean,
  opts?: {
    user?: AuthenticatedUser;
    project?: Project;
    members?: ProjectMember[];
  },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['milestone-detail', detail.id], detail);
  if (opts?.user) client.setQueryData(['auth', 'me'], opts.user);
  if (opts?.project) client.setQueryData(['project', 'proj-1'], opts.project);
  if (opts?.members) client.setQueryData(['project-members', 'proj-1'], opts.members);

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
    </QueryClientProvider>,
  );
}

describe('MilestoneDetailModal (KAN-248, KAN-249 y KAN-250)', () => {
  it('renderiza datos del hito, tareas asociadas, estados reales y progreso (KAN-248)', () => {
    const html = renderModal(samplePendingDetail, true);
    expect(html).toContain('Lanzamiento v1.0');
    expect(html).toContain('Entrega final con todas las funcionalidades.');
    expect(html).toContain('Configurar servidor');
    expect(html).toContain('Pruebas de carga');
    expect(html).toContain('Dev Ops');
    expect(html).toContain('QA Tester');
    expect(html).toContain('50%');
    // Estados reales legibles (KAN-248)
    expect(html).toContain('Completada');
    expect(html).toContain('En curso');
    // Información de progreso de subtareas cuando corresponda (KAN-248)
    expect(html).toContain('Subtareas: 2/3 (67%)');
  });

  it('muestra correctamente todos los estados reales de tareas principales (PENDING, IN_PROGRESS, IN_REVIEW, BLOCKED, COMPLETED) y muestra subtareas con acceso a su detalle', () => {
    const allStatesDetail: MilestoneDetailDto = {
      ...samplePendingDetail,
      tasks: [
        { id: 't1', title: 'T1', status: 'PENDING', priority: 'LOW', startDate: null, dueDate: null, parentTaskId: null, assignedTo: null },
        { id: 't2', title: 'T2', status: 'IN_PROGRESS', priority: 'LOW', startDate: null, dueDate: null, parentTaskId: null, assignedTo: null },
        { id: 't3', title: 'T3', status: 'IN_REVIEW', priority: 'LOW', startDate: null, dueDate: null, parentTaskId: null, assignedTo: null },
        { id: 't4', title: 'T4', status: 'BLOCKED', priority: 'LOW', startDate: null, dueDate: null, parentTaskId: null, assignedTo: null },
        { id: 't5', title: 'T5', status: 'COMPLETED', priority: 'LOW', startDate: null, dueDate: null, parentTaskId: null, assignedTo: null },
        { id: 'sub-hist', title: 'Subtarea Histórica Excluida', status: 'PENDING', priority: 'LOW', startDate: null, dueDate: null, parentTaskId: 't1', assignedTo: null },
      ],
    };

    const html = renderModal(allStatesDetail, true);
    expect(html).toContain('Pendiente');
    expect(html).toContain('En curso');
    expect(html).toContain('En revisión');
    expect(html).toContain('Bloqueada');
    expect(html).toContain('Completada');
    expect(html).toContain('Subtarea Histórica Excluida');
    expect(html).toContain('/projects/proj-1?taskId=sub-hist');
    expect(html).toContain('Tarea principal:');
  });

  it('renderiza checkboxes sincronizados con el estado de cada tarea (KAN-249)', () => {
    const html = renderModal(samplePendingDetail, true);
    // task-101 está COMPLETED -> checkbox marcado (checked)
    const cb101 = html.match(/<input[^>]*id="milestone-task-checkbox-task-101"[^>]*>/)?.[0] ?? '';
    expect(cb101).toContain('type="checkbox"');
    expect(cb101).toContain('checked=""');
    expect(cb101).not.toContain('disabled=""');

    // task-102 está IN_PROGRESS -> checkbox desmarcado
    const cb102 = html.match(/<input[^>]*id="milestone-task-checkbox-task-102"[^>]*>/)?.[0] ?? '';
    expect(cb102).toContain('type="checkbox"');
    expect(cb102).not.toContain('checked=""');
    expect(cb102).not.toContain('disabled=""');
  });

  it('respeta canEditTaskUI en los checkboxes: COLLABORATOR habilita solo su tarea asignada y deshabilita la ajena (KAN-249)', () => {
    const collabUser: AuthenticatedUser = {
      id: 'u-3',
      email: 'qa@tema.com',
      name: 'QA Tester',
      avatarUrl: null,
      roles: ['COLLABORATOR'],
    };
    const project: Project = {
      id: 'proj-1',
      name: 'Proyecto 1',
      leaderId: 'u-1',
    } as Project;
    const members: ProjectMember[] = [
      { id: 'pm-1', projectId: 'proj-1', userId: 'u-3', projectRole: 'COLLABORATOR', joinedAt: '' },
    ];

    const html = renderModal(samplePendingDetail, false, { user: collabUser, project, members });

    // task-101 pertenece a u-2 -> deshabilitado para u-3
    const cb101 = html.match(/<input[^>]*id="milestone-task-checkbox-task-101"[^>]*>/)?.[0] ?? '';
    expect(cb101).toContain('disabled=""');

    // task-102 está asignada a u-3 -> habilitado para u-3
    const cb102 = html.match(/<input[^>]*id="milestone-task-checkbox-task-102"[^>]*>/)?.[0] ?? '';
    expect(cb102).not.toContain('disabled=""');
  });

  it('cuando canManage=true en hito con tareas pendientes: muestra un único botón claro "Finalizar hito y tareas" sin botón redundante (KAN-250)', () => {
    const html = renderModal(samplePendingDetail, true);
    expect(html).toContain('Finalizar hito y tareas');
    expect(html).not.toContain('Marcar como alcanzado');
    expect(html).toContain('Vincular tareas');
    expect(html).toContain('Editar hito');
    expect(html).toContain('Eliminar');
    expect(html).toContain('Desasociar');
  });

  it('cuando canManage=true en hito pendiente sin tareas pendientes (ej. vacío): muestra "Marcar como alcanzado"', () => {
    const emptyDetail: MilestoneDetailDto = {
      ...samplePendingDetail,
      taskCount: 0,
      completedTaskCount: 0,
      progress: 0,
      tasks: [],
    };
    const html = renderModal(emptyDetail, true);
    expect(html).toContain('Marcar como alcanzado');
    expect(html).not.toContain('Finalizar hito y tareas');
  });

  it('cuando canManage=true en hito completado: muestra "Reabrir hito" y oculta botones redundantes de finalización', () => {
    const html = renderModal(sampleCompletedDetail, true);
    expect(html).toContain('Reabrir hito');
    expect(html).not.toContain('Marcar como alcanzado');
    expect(html).not.toContain('Finalizar hito y tareas');
  });

  it('diferencia visualmente el hito completado automáticamente (completedById === null) del confirmado manualmente', () => {
    const autoCompletedDetail: MilestoneDetailDto = {
      ...sampleCompletedDetail,
      completedById: null,
      completedBy: undefined,
    };
    const html = renderModal(autoCompletedDetail, true);
    expect(html).toContain('Alcanzado automáticamente el');
  });

  it('cuando canManage=false (solo lectura): NO muestra botones de administración', () => {
    const html = renderModal(samplePendingDetail, false);
    expect(html).not.toContain('Marcar como alcanzado');
    expect(html).not.toContain('Finalizar hito y tareas');
    expect(html).not.toContain('Vincular tareas');
    expect(html).not.toContain('Editar hito');
    expect(html).not.toContain('Eliminar');
    expect(html).not.toContain('Desasociar');
    // Pero sí muestra la información y las tareas
    expect(html).toContain('Configurar servidor');
  });
});


afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([false, true])('desvincula el elemento sin modificar otros vínculos (es subtarea: %s)', async (isSubtask) => {
  const task = { ...samplePendingDetail.tasks[0]!, id: 'linked-item', title: 'Elemento vinculado',
    parentTaskId: isSubtask ? 'parent-task' : null, parentTaskTitle: isSubtask ? 'Tarea principal de prueba' : null };
  let detail = { ...samplePendingDetail, tasks: [task] };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['milestone-detail', detail.id], detail);
  client.setQueryData(['auth', 'me'], { id: 'u-1', roles: ['PROJECT_LEADER'] });
  client.setQueryData(['project', 'proj-1'], { id: 'proj-1', leaderId: 'u-1' });
  client.setQueryData(['project-members', 'proj-1'], []);
  vi.spyOn(api, 'getMilestone').mockImplementation(async () => detail);
  const unlink = vi.spyOn(api, 'disassociateMilestoneTask').mockImplementation(async () => {
    detail = { ...detail, tasks: [] };
    return samplePendingDetail;
  });
  render(<QueryClientProvider client={client}>
    <MilestoneDetailModal isOpen onClose={vi.fn()} milestoneId={detail.id} projectId="proj-1" canManage onMilestoneUpdated={vi.fn()} />
  </QueryClientProvider>);
  expect(screen.getByRole('link', { name: /Abrir/ }).getAttribute('href')).toBe('/projects/proj-1?taskId=linked-item');
  if (isSubtask) expect(screen.getByText('Tarea principal: Tarea principal de prueba')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Desasociar' }));
  await waitFor(() => expect(unlink).toHaveBeenCalledWith(detail.id, 'linked-item'));
  await waitFor(() => expect(screen.queryByText('Elemento vinculado')).toBeNull());
  expect(unlink).toHaveBeenCalledTimes(1);
});
