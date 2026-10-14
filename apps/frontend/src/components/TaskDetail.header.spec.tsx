// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as useCurrentUserModule from '../hooks/useCurrentUser';
import * as useMyMembershipModule from '../hooks/useMyMembership';
import { TaskDetail } from './TaskDetail';
import type { Task } from '../types/task';

vi.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(),
}));

vi.mock('../hooks/useMyMembership', () => ({
  useMyMembership: vi.fn(),
}));

const TASK_UUID = 'e8b8c2d1-9452-47ef-8a3c-1b7f03d65a29';
const PROJECT_UUID = 'f1a9b8c7-d6e5-4a3b-2c1d-0e9f8a7b6c5d';

const mockTask: Task = {
  id: TASK_UUID,
  projectId: PROJECT_UUID,
  parentTaskId: null,
  title: 'Implementar autenticación multifactor',
  description: 'Se debe configurar MFA utilizando TOTP para todos los administradores.',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  assignedToId: 'user-uuid-1',
  assignedTo: { id: 'user-uuid-1', name: 'Laura Martínez', email: 'laura@tema.com', avatarUrl: null, active: true },
  startDate: '2026-10-15',
  dueDate: '2026-10-30',
  createdBy: 'user-uuid-1',
  createdAt: '2026-10-01T12:00:00Z',
  updatedAt: '2026-10-14T10:00:00Z',
  archivedAt: null,
  project: {
    id: PROJECT_UUID,
    name: 'Proyecto Ciberseguridad',
    leaderId: 'user-uuid-1',
  },
};

function renderTaskDetail(taskData = mockTask, onBack = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });

  client.setQueryData(['task', taskData.id], taskData);
  client.setQueryData(['project-members', taskData.projectId], []);
  client.setQueryData(['subtasks', taskData.id], []);
  client.setQueryData(['task', taskData.id, 'timeline'], [
    {
      id: 'comment-1',
      type: 'COMMENT',
      content: 'Primer comentario sobre la implementación.',
      actor: { id: 'user-uuid-1', name: 'Laura Martínez' },
      createdAt: '2026-10-14T11:00:00Z',
    },
  ]);

  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskDetail taskId={taskData.id} onBack={onBack} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...utils, onBack };
}

describe('TaskDetail - Encabezado del detalle de tarea', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useCurrentUserModule.useCurrentUser as any).mockReturnValue({
      user: { id: 'user-uuid-1', name: 'Laura Martínez', roles: ['ADMIN'] },
    });
    (useMyMembershipModule.useMyMembership as any).mockReturnValue({
      membership: { projectRole: 'COLLABORATOR' },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('el encabezado muestra únicamente el nombre de la tarea y no muestra el UUID visible', () => {
    renderTaskDetail();

    // El título principal h1 contiene únicamente el nombre de la tarea
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Implementar autenticación multifactor');

    // El UUID interno largo no debe estar visible en el encabezado ni como texto renderizado
    expect(heading.textContent).not.toContain(TASK_UUID);
    expect(screen.queryByText(new RegExp(TASK_UUID, 'i'))).toBeNull();

    // No se reemplazó por ningún código abreviado (#..., TASK-..., etc.)
    expect(heading.textContent).not.toMatch(/#\w+/);
    expect(heading.textContent).not.toMatch(/TASK-\w+/i);
  });

  it('conserva el resto del detalle intacto: descripción, estado, prioridad, responsable, fechas, comentarios y acciones', () => {
    renderTaskDetail();

    // Descripción
    expect(screen.getByText('Descripción')).toBeTruthy();
    expect(screen.getByText('Se debe configurar MFA utilizando TOTP para todos los administradores.')).toBeTruthy();

    // Estado (dropdown interactivo) y prioridad
    expect(screen.getByRole('button', { name: /En curso/i })).toBeTruthy();
    expect(screen.getByText('Alta')).toBeTruthy();

    // Responsable
    expect(screen.getByText('Responsable')).toBeTruthy();
    expect(screen.getAllByText('Laura Martínez').length).toBeGreaterThanOrEqual(1);

    // Fechas
    expect(screen.getByText('Fechas')).toBeTruthy();
    expect(screen.getByText('Inicio')).toBeTruthy();
    expect(screen.getByText('Vencimiento')).toBeTruthy();

    // Acciones para usuario con permisos
    expect(screen.getByRole('link', { name: 'Editar tarea' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archivar tarea' })).toBeTruthy();

    // Subtareas
    expect(screen.getByText('Subtareas')).toBeTruthy();

    // Actividad y Comentarios
    expect(screen.getByText('Actividad y Comentarios')).toBeTruthy();
    expect(screen.getByText('Primer comentario sobre la implementación.')).toBeTruthy();
  });

  it('el botón de volver ejecuta onBack correctamente', () => {
    const onBack = vi.fn();
    renderTaskDetail(mockTask, onBack);

    const backButton = screen.getByRole('button', { name: /Volver a tareas/i });
    fireEvent.click(backButton);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
