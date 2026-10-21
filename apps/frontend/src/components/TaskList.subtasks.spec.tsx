// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@tema/shared-types';
import type { Task, TaskListResponse } from '../types/task';
import { api, ApiRequestError } from '../lib/api';
import { TaskList } from './TaskList';
import type { TaskListPersistedState } from './TaskList';
import { ProjectPage } from '../pages/ProjectPage';

const PROJECT_ID = 'project-1';

const currentUser: AuthenticatedUser = {
  id: 'user-1',
  email: 'lider@tema.com',
  name: 'Diana Paz',
  avatarUrl: null,
  roles: ['PROJECT_LEADER'],
};

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    slug: overrides.id,
    projectId: PROJECT_ID,
    parentTaskId: null,
    description: null,
    status: 'PENDING',
    priority: 'MEDIUM',
    assignedToId: null,
    startDate: null,
    dueDate: '2026-12-15',
    createdBy: 'user-1',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    archivedAt: null,
    project: { id: PROJECT_ID, name: 'Proyecto TEMA', leaderId: 'user-1', estimatedEndDate: '2026-12-31' },
    ...overrides,
  };
}

function taskPage(data: Task[]): TaskListResponse {
  return { data, total: data.length, page: 1, limit: 10, totalPages: Math.ceil(data.length / 10),
    counts: { all: data.length, mine: data.filter(t => t.assignedToId === currentUser.id).length, atRisk: 0 } };
}

function setupRender(
  tasks: Task[],
  onSelectTask = vi.fn(),
  options?: {
    persistedState?: TaskListPersistedState | null;
    onPersistedStateChange?: (state: TaskListPersistedState) => void;
  },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['auth', 'me'], currentUser);
  client.setQueryData(['project', PROJECT_ID], {
    id: PROJECT_ID,
    slug: 'proyecto-tema',
    name: 'Proyecto TEMA',
    leaderId: 'user-1',
    leader: { id: 'user-1', name: 'Diana Paz', email: 'lider@tema.com', avatarUrl: null, active: true },
    estimatedEndDate: '2026-12-31',
  });
  client.setQueryData(['project-members', PROJECT_ID], [
    {
      id: 'm-1',
      projectId: PROJECT_ID,
      userId: 'user-2',
      projectRole: 'COLLABORATOR',
      joinedAt: '2026-10-01T00:00:00Z',
      user: { id: 'user-2', name: 'Carlos Ruiz', email: 'carlos@tema.com', avatarUrl: null, active: true },
    },
  ]);
  client.setQueryData(['tasks', { projectId: PROJECT_ID, page: 1, limit: 10 }, 'ALL'], taskPage(tasks));

  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskList
          projectId={PROJECT_ID}
          onSelectTask={onSelectTask}
          persistedState={options?.persistedState}
          onPersistedStateChange={options?.onPersistedStateChange}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...utils, client, onSelectTask };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TaskList - desplegable de subtareas', () => {
  it('1) expande y contrae subtareas bajo demanda, permite múltiples expandidas y no anida botones HTML', async () => {
    const task1 = makeTask({ id: 't1', slug: 'tarea-uno', title: 'Tarea Uno', subtaskCount: 1, completedSubtaskCount: 0 });
    const task2 = makeTask({ id: 't2', slug: 'tarea-dos', title: 'Tarea Dos', subtaskCount: 1, completedSubtaskCount: 0 });

    const getSubtasksSpy = vi.spyOn(api, 'getSubtasks').mockImplementation(async (taskId: string) => {
      if (taskId === 't1') {
        return [makeTask({ id: 'sub-1', parentTaskId: 't1', title: 'Subtarea de Uno' })];
      }
      return [makeTask({ id: 'sub-2', parentTaskId: 't2', title: 'Subtarea de Dos' })];
    });

    const { container, onSelectTask } = setupRender([task1, task2]);

    // No existen botones anidados (<button> dentro de <button>)
    expect(container.querySelectorAll('button button').length).toBe(0);

    // No se consulta api.getSubtasks antes de expandir (sin N+1 peticiones)
    expect(getSubtasksSpy).not.toHaveBeenCalled();

    const expandBtn1 = screen.getByRole('button', { name: 'Expandir subtareas de Tarea Uno' });
    const expandBtn2 = screen.getByRole('button', { name: 'Expandir subtareas de Tarea Dos' });
    expect(expandBtn1.getAttribute('aria-expanded')).toBe('false');
    expect(expandBtn2.getAttribute('aria-expanded')).toBe('false');

    // Expandir Tarea Uno
    fireEvent.click(expandBtn1);
    expect(onSelectTask).not.toHaveBeenCalled();
    expect(getSubtasksSpy).toHaveBeenCalledTimes(1);
    expect(getSubtasksSpy).toHaveBeenCalledWith('t1');

    await screen.findByText('Subtarea de Uno');
    expect(
      screen.getByRole('button', { name: 'Contraer subtareas de Tarea Uno' }).getAttribute('aria-expanded'),
    ).toBe('true');

    // Expandir Tarea Dos simultáneamente
    fireEvent.click(expandBtn2);
    await screen.findByText('Subtarea de Dos');
    expect(screen.getByText('Subtarea de Uno')).toBeTruthy();
    expect(screen.getByText('Subtarea de Dos')).toBeTruthy();
    expect(getSubtasksSpy).toHaveBeenCalledTimes(2);

    // Contraer Tarea Uno
    fireEvent.click(screen.getByRole('button', { name: 'Contraer subtareas de Tarea Uno' }));
    expect(screen.queryByText('Subtarea de Uno')).toBeNull();
    expect(screen.getByText('Subtarea de Dos')).toBeTruthy();

    expect(container.querySelectorAll('button button').length).toBe(0);
  });

  it('2) muestra las subtareas con título, responsable, estado, prioridad y vencimiento alineados y diseño responsive', async () => {
    const parent = makeTask({ id: 't1', title: 'Diseño de arquitectura', subtaskCount: 2, completedSubtaskCount: 1 });
    const subtasks: Task[] = [
      makeTask({
        id: 'sub-1',
        parentTaskId: 't1',
        title: 'Definir modelo de datos',
        description: 'Tablas principales y relaciones',
        status: 'COMPLETED',
        priority: 'HIGH',
        dueDate: '2026-11-20',
        assignedToId: 'user-2',
        assignedTo: {
          id: 'user-2',
          name: 'Carlos Ruiz',
          email: 'carlos@tema.com',
          avatarUrl: null,
          active: true,
        },
      }),
      makeTask({
        id: 'sub-2',
        parentTaskId: 't1',
        title: 'Configurar migraciones',
        status: 'IN_PROGRESS',
        priority: 'CRITICAL',
        dueDate: null,
        assignedToId: null,
      }),
    ];

    vi.spyOn(api, 'getSubtasks').mockResolvedValue(subtasks);
    const { container } = setupRender([parent]);

    // El contenedor de la tabla soporta scroll horizontal en pantallas pequeñas (overflow-x-auto y min-w-[680px])
    expect(container.querySelector('.overflow-x-auto')).toBeTruthy();
    expect(container.querySelector('.min-w-\\[680px\\]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Expandir subtareas de Diseño de arquitectura' }));

    const panel = await screen.findByRole('region', { name: 'Subtareas de Diseño de arquitectura' });
    expect(await within(panel).findByText('Definir modelo de datos')).toBeTruthy();
    expect(within(panel).getByText('Tablas principales y relaciones')).toBeTruthy();
    expect(within(panel).getByText('CR')).toBeTruthy();
    expect(within(panel).getByText('Carlos')).toBeTruthy();
    expect(within(panel).getByText('Completada')).toBeTruthy();
    expect(within(panel).getByText('Alta')).toBeTruthy();

    expect(within(panel).getByText('Configurar migraciones')).toBeTruthy();
    expect(within(panel).getByText('En curso')).toBeTruthy();
    expect(within(panel).getByText('Crítica')).toBeTruthy();

    // Subtarea completada lleva estilo tachado
    const completedTitle = within(panel).getByText('Definir modelo de datos');
    expect(completedTitle.className).toContain('line-through');
  });

  it('3) muestra correctamente los estados de carga y error al expandir, y no permite expandir tareas sin subtareas', async () => {
    const taskLoading = makeTask({ id: 't-loading', title: 'Tarea Cargando', subtaskCount: 1, completedSubtaskCount: 0 });
    const taskEmpty = makeTask({ id: 't-empty', title: 'Tarea Sin Subtareas', subtaskCount: 0, completedSubtaskCount: 0 });
    const taskError = makeTask({ id: 't-error', title: 'Tarea Con Error', subtaskCount: 2, completedSubtaskCount: 0 });

    let resolveLoading!: (value: Task[]) => void;
    const getSubtasksSpy = vi.spyOn(api, 'getSubtasks').mockImplementation((taskId: string) => {
      if (taskId === 't-loading') {
        return new Promise<Task[]>((resolve) => {
          resolveLoading = resolve;
        });
      }
      return Promise.reject(new Error('Network error'));
    });

    setupRender([taskLoading, taskEmpty, taskError]);

    // La tarea sin subtareas NO tiene botón de expandir ni puede abrir región de subtareas
    expect(screen.queryByRole('button', { name: /Expandir subtareas de Tarea Sin Subtareas/i })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Subtareas de Tarea Sin Subtareas' })).toBeNull();

    // Estado cargando
    fireEvent.click(screen.getByRole('button', { name: 'Expandir subtareas de Tarea Cargando' }));
    expect(screen.getByText('Cargando subtareas…')).toBeTruthy();
    resolveLoading([makeTask({ id: 'sub-loaded', parentTaskId: 't-loading', title: 'Subtarea Cargada' })]);
    await waitFor(() => {
      expect(screen.queryByText('Cargando subtareas…')).toBeNull();
    });
    expect(await screen.findByText('Subtarea Cargada')).toBeTruthy();

    // Estado error
    fireEvent.click(screen.getByRole('button', { name: 'Expandir subtareas de Tarea Con Error' }));
    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert.textContent).toContain('Error al cargar las subtareas.');
    expect(getSubtasksSpy).not.toHaveBeenCalledWith('t-empty');
  });

  it('4) muestra flecha y contador (ej. 0/5 y 2/3) solo cuando hay subtareas, oculta ambos para 0/0 manteniendo alineación de columnas y sin consultas N+1', () => {
    const taskA = makeTask({
      id: 't-a',
      title: 'Tarea A',
      subtaskCount: 5,
      completedSubtaskCount: 0,
    });
    const taskB = makeTask({
      id: 't-b',
      title: 'Tarea B',
      subtaskCount: 3,
      completedSubtaskCount: 2,
    });
    const taskC = makeTask({
      id: 't-c',
      title: 'Tarea C',
      subtaskCount: 0,
      completedSubtaskCount: 0,
    });

    const getSubtasksSpy = vi.spyOn(api, 'getSubtasks');

    const { container } = setupRender([taskA, taskB, taskC]);

    // Tarea A y Tarea B tienen subtareas -> muestran flecha y contador inmediatamente antes de expandir
    expect(screen.getByRole('button', { name: 'Expandir subtareas de Tarea A' })).toBeTruthy();
    const badgeA = screen.getByText('0/5');
    expect(badgeA.getAttribute('aria-label')).toBe('Subtareas completadas: 0 de 5');

    expect(screen.getByRole('button', { name: 'Expandir subtareas de Tarea B' })).toBeTruthy();
    const badgeB = screen.getByText('2/3');
    expect(badgeB.getAttribute('aria-label')).toBe('Subtareas completadas: 2 de 3');

    // Tarea C no tiene subtareas (0/0) -> NO muestra ni flecha ni contador 0/0
    expect(screen.queryByRole('button', { name: /Expandir subtareas de Tarea C/i })).toBeNull();
    expect(screen.queryByText('0/0')).toBeNull();

    // Todas las filas mantienen exactamente el mismo contenedor de margen izquierdo (w-10 shrink-0 pl-3) y la misma grilla de columnas
    const leftSlots = container.querySelectorAll('.w-10.shrink-0.pl-3');
    // 1 en la cabecera + 3 en las filas de tareas = 4
    expect(leftSlots.length).toBe(4);
    const gridRows = container.querySelectorAll('.grid-cols-\\[1fr_120px_120px_110px_100px\\]');
    // 1 en la cabecera + 3 en las filas de tareas = 4
    expect(gridRows.length).toBe(4);

    // No se disparan N peticiones individuales de subtareas al renderizar la lista
    expect(getSubtasksSpy).not.toHaveBeenCalled();
  });

  it('5) navega al detalle tanto de la tarea principal como de una subtarea usando su slug (o id)', async () => {
    const parent = makeTask({
      id: 't1',
      slug: 'tarea-principal-slug',
      title: 'Tarea Principal',
      subtaskCount: 2,
      completedSubtaskCount: 0,
    });
    const subtaskWithSlug = makeTask({
      id: 'sub-1',
      slug: 'subtarea-con-slug',
      parentTaskId: 't1',
      title: 'Subtarea Con Slug',
    });
    const subtaskWithoutSlug = makeTask({
      id: 'sub-uuid-2',
      slug: undefined,
      parentTaskId: 't1',
      title: 'Subtarea Sin Slug',
    });

    vi.spyOn(api, 'getSubtasks').mockResolvedValue([subtaskWithSlug, subtaskWithoutSlug]);
    const onSelectTask = vi.fn();
    setupRender([parent], onSelectTask);

    // Click en el título de la tarea principal navega a su slug
    fireEvent.click(screen.getByText('Tarea Principal'));
    expect(onSelectTask).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith('tarea-principal-slug');

    // Expandir subtareas
    fireEvent.click(screen.getByRole('button', { name: 'Expandir subtareas de Tarea Principal' }));
    await screen.findByText('Subtarea Con Slug');

    // Click en subtarea con slug navega a su slug
    fireEvent.click(screen.getByText('Subtarea Con Slug'));
    expect(onSelectTask).toHaveBeenCalledTimes(2);
    expect(onSelectTask).toHaveBeenLastCalledWith('subtarea-con-slug');

    // Click en subtarea sin slug usa su id
    fireEvent.click(screen.getByText('Subtarea Sin Slug'));
    expect(onSelectTask).toHaveBeenCalledTimes(3);
    expect(onSelectTask).toHaveBeenLastCalledWith('sub-uuid-2');
  });

  it('6) crea una subtarea desde "+ Subtarea" sin error 500, actualiza lista/contador sin recargar y no duplica ante error', async () => {
    let parentTask = makeTask({
      id: 't1',
      title: 'Tarea Padre',
      subtaskCount: 1,
      completedSubtaskCount: 0,
    });
    let subtasksList: Task[] = [
      makeTask({ id: 's1', parentTaskId: 't1', title: 'Subtarea Existente', status: 'PENDING' }),
    ];

    vi.spyOn(api, 'listTasks').mockImplementation(async () => taskPage([parentTask]));
    vi.spyOn(api, 'getSubtasks').mockImplementation(async () => subtasksList);

    const createTaskSpy = vi.spyOn(api, 'createTask');

    setupRender([parentTask]);

    // Contador inicial visible antes de expandir
    expect(screen.getByText('0/1')).toBeTruthy();

    // Expandimos la tarea padre para ver sus subtareas actuales
    fireEvent.click(screen.getByRole('button', { name: 'Expandir subtareas de Tarea Padre' }));
    await screen.findByText('Subtarea Existente');

    // Abrimos el modal "+ Subtarea"
    fireEvent.click(screen.getByRole('button', { name: 'Agregar subtarea a Tarea Padre' }));
    const dialog = screen.getByRole('dialog', { name: 'Nueva subtarea de Tarea Padre' });
    expect(dialog).toBeTruthy();

    // Simulamos un primer fallo real del servidor (donde la transacción en backend hace rollback y NO persiste duplicados)
    createTaskSpy.mockRejectedValueOnce(
      new ApiRequestError(500, 'Internal Server Error', ['Error temporal de base de datos']),
    );

    const titleInput = within(dialog).getByLabelText('Título *');
    fireEvent.change(titleInput, { target: { value: 'Nueva Subtarea Creada' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear tarea' }));

    // Se muestra el error real y el modal permanece abierto sin haber creado subtareas fantasma
    expect(await within(dialog).findByText('Error temporal de base de datos')).toBeTruthy();
    expect(subtasksList).toHaveLength(1);
    expect(screen.getByText('0/1')).toBeTruthy();

    // Ahora el usuario reintenta guardar y el servidor responde con éxito (201)
    createTaskSpy.mockImplementationOnce(async (payload) => {
      const created = makeTask({
        id: 's2',
        slug: 'nueva-subtarea-creada',
        parentTaskId: payload.parentTaskId ?? 't1',
        title: payload.title,
        status: 'PENDING',
      });
      subtasksList = [...subtasksList, created];
      parentTask = { ...parentTask, subtaskCount: 2, completedSubtaskCount: 0 };
      return created;
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear tarea' }));

    // La interfaz muestra el mensaje de éxito "¡Subtarea creada!" y actualiza lista y contador (0/2) sin recargar
    expect(await within(dialog).findByText('¡Subtarea creada!')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));

    expect(await screen.findByText('Nueva Subtarea Creada')).toBeTruthy();
    expect(screen.getAllByText('Nueva Subtarea Creada')).toHaveLength(1);
    expect(screen.getByText('0/2')).toBeTruthy();
  });

  it('7) actualiza el desplegable y el contador al completar, editar o archivar/desarchivar una subtarea', async () => {
    let parent = makeTask({
      id: 't1',
      title: 'Tarea Padre',
      subtaskCount: 2,
      completedSubtaskCount: 1,
    });
    let currentSubtasks: Task[] = [
      makeTask({ id: 's1', parentTaskId: 't1', title: 'Subtarea 1', status: 'PENDING' }),
      makeTask({ id: 's2', parentTaskId: 't1', title: 'Subtarea 2', status: 'COMPLETED' }),
    ];

    vi.spyOn(api, 'listTasks').mockImplementation(async () => taskPage([parent]));
    vi.spyOn(api, 'getSubtasks').mockImplementation(async () => currentSubtasks);
    const { client } = setupRender([parent]);

    // Visible antes de expandir
    expect(screen.getByText('1/2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Expandir subtareas de Tarea Padre' }));
    await screen.findByText('Subtarea 1');
    expect(screen.getByText('1/2')).toBeTruthy();

    // 1. Completar y editar Subtarea 1 -> contador pasa a 2/2
    currentSubtasks = [
      makeTask({ id: 's1', parentTaskId: 't1', title: 'Subtarea 1 actualizada', status: 'COMPLETED' }),
      makeTask({ id: 's2', parentTaskId: 't1', title: 'Subtarea 2', status: 'COMPLETED' }),
    ];
    parent = { ...parent, subtaskCount: 2, completedSubtaskCount: 2 };
    await client.invalidateQueries({ queryKey: ['subtasks'] });
    await client.invalidateQueries({ queryKey: ['tasks'] });

    await screen.findByText('Subtarea 1 actualizada');
    expect(await screen.findByText('2/2')).toBeTruthy();

    // 2. Archivar Subtarea 2 -> las subtareas archivadas no cuentan en el total activo (pasa a 1/1)
    currentSubtasks = [
      makeTask({ id: 's1', parentTaskId: 't1', title: 'Subtarea 1 actualizada', status: 'COMPLETED' }),
      makeTask({
        id: 's2',
        parentTaskId: 't1',
        title: 'Subtarea 2',
        status: 'COMPLETED',
        archivedAt: '2026-10-18T12:00:00Z',
      }),
    ];
    parent = { ...parent, subtaskCount: 1, completedSubtaskCount: 1 };
    await client.invalidateQueries({ queryKey: ['subtasks'] });
    await client.invalidateQueries({ queryKey: ['tasks'] });

    expect(await screen.findByText('1/1')).toBeTruthy();
  });

  it('8) conserva el funcionamiento de filtros y búsqueda junto con las tareas expandidas', async () => {
    const taskMine = makeTask({
      id: 't1',
      title: 'Auditar permisos',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignedToId: 'user-1',
      subtaskCount: 1,
      completedSubtaskCount: 1,
    });
    const taskOther = makeTask({
      id: 't2',
      title: 'Redactar informe',
      status: 'PENDING',
      priority: 'LOW',
      assignedToId: 'user-2',
      subtaskCount: 0,
      completedSubtaskCount: 0,
    });

    vi.spyOn(api, 'getSubtasks').mockResolvedValue([
      makeTask({ id: 's1', parentTaskId: 't1', title: 'Revisar matriz de roles', status: 'COMPLETED' }),
    ]);
    const listTasksSpy = vi.spyOn(api, 'listTasks').mockImplementation(async (filters) => {
      return taskPage([taskMine, taskOther].filter((t) => {
        if (filters.myTasks && t.assignedToId !== currentUser.id) return false;
        if (filters.status && t.status !== filters.status) return false;
        if (filters.priority && t.priority !== filters.priority) return false;
        if (filters.search && !t.title.toLowerCase().includes(filters.search.toLowerCase())) return false;
        return true;
      }));
    });

    setupRender([taskMine, taskOther]);

    // Expandir 'Auditar permisos'
    fireEvent.click(screen.getByRole('button', { name: 'Expandir subtareas de Auditar permisos' }));
    await screen.findByText('Revisar matriz de roles');

    // Filtro client-side "Mis tareas"
    fireEvent.click(screen.getByRole('button', { name: /Mis tareas/i }));
    expect(screen.getByText('Auditar permisos')).toBeTruthy();
    expect(screen.getByText('Revisar matriz de roles')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Redactar informe')).toBeNull());

    // Volver a "Todas"
    fireEvent.click(screen.getByRole('button', { name: /Todas/i }));
    expect(screen.getByText('Redactar informe')).toBeTruthy();

    // Filtrar por estado "En curso"
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0]!, { target: { value: 'IN_PROGRESS' } });
    await waitFor(() => {
      expect(listTasksSpy).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT_ID, status: 'IN_PROGRESS', page: 1, limit: 10 }));
    });
    expect(await screen.findByText('Auditar permisos')).toBeTruthy();
    expect(screen.getByText('Revisar matriz de roles')).toBeTruthy();
    expect(screen.queryByText('Redactar informe')).toBeNull();
  });

  it('9) conserva scroll exacto, múltiples tareas expandidas, filtros, búsqueda y slugs al ir al detalle de tarea/subtarea y volver', async () => {
    const task1 = makeTask({
      id: 't1',
      slug: 'diseno-sistema',
      title: 'Diseño del Sistema',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignedToId: 'user-1',
      subtaskCount: 1,
      completedSubtaskCount: 1,
    });
    const task2 = makeTask({
      id: 't2',
      slug: 'desarrollo-api',
      title: 'Desarrollo de API',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignedToId: 'user-1',
      subtaskCount: 1,
      completedSubtaskCount: 0,
    });
    const sub1 = makeTask({
      id: 's1',
      slug: 'esquema-base-datos',
      parentTaskId: 't1',
      title: 'Esquema de Base de Datos',
      status: 'COMPLETED',
    });
    const sub2 = makeTask({
      id: 's2',
      slug: 'endpoints-tareas',
      parentTaskId: 't2',
      title: 'Endpoints de Tareas',
      status: 'IN_PROGRESS',
    });

    vi.spyOn(api, 'getProject').mockResolvedValue({
      id: PROJECT_ID,
      slug: 'proyecto-tema',
      name: 'Proyecto TEMA',
      description: null,
      status: 'IN_PROGRESS',
      startDate: '2026-01-01',
      estimatedEndDate: '2026-12-31',
      leaderId: 'user-1',
      leader: { id: 'user-1', name: 'Diana Paz', email: 'lider@tema.com', avatarUrl: null, active: true },
      createdBy: 'user-1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      archivedAt: null,
    });
    vi.spyOn(api, 'getProjectMembers').mockResolvedValue([]);
    vi.spyOn(api, 'listTasks').mockImplementation(async (filters) => {
      return taskPage([task1, task2].filter((t) => {
        if (filters.myTasks && t.assignedToId !== currentUser.id) return false;
        if (filters.status && t.status !== filters.status) return false;
        if (filters.search && !t.title.toLowerCase().includes(filters.search.toLowerCase())) return false;
        return true;
      }));
    });
    vi.spyOn(api, 'getSubtasks').mockImplementation(async (taskId: string) => {
      if (taskId === 't1') return [sub1];
      if (taskId === 't2') return [sub2];
      return [];
    });
    vi.spyOn(api, 'getTask').mockImplementation(async (identifier: string) => {
      if (identifier === 'esquema-base-datos' || identifier === 's1') return sub1;
      return task1;
    });
    vi.spyOn(api, 'getTaskTimeline').mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });

    let simulatedScrollY = 0;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => simulatedScrollY,
    });
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'object' && first !== null && 'top' in first) {
        simulatedScrollY = (first as { top?: number }).top ?? 0;
      } else if (typeof args[1] === 'number') {
        simulatedScrollY = args[1];
      }
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(['auth', 'me'], currentUser);

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/projects/proyecto-tema?view=tasks']}>
          <Routes>
            <Route path="/projects/:projectId" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Esperar a que carguen las tareas de la lista
    await screen.findByText('Diseño del Sistema');
    expect(screen.getByText('Desarrollo de API')).toBeTruthy();

    // Expandir ambas tareas
    fireEvent.click(screen.getByRole('button', { name: 'Expandir subtareas de Diseño del Sistema' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expandir subtareas de Desarrollo de API' }));
    await screen.findByText('Esquema de Base de Datos');
    await screen.findByText('Endpoints de Tareas');

    // Aplicar filtro de estado "En curso", filtro rápido "Mis tareas" y búsqueda
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0]!, { target: { value: 'IN_PROGRESS' } });
    fireEvent.click(screen.getByRole('button', { name: /Mis tareas/i }));
    const searchBox = screen.getByPlaceholderText('Buscar por título o descripción…');
    fireEvent.change(searchBox, { target: { value: 'Diseño' } });

    // Esperar a que termine la consulta filtrada antes de navegar al detalle
    const subtaskRow = await screen.findByText('Esquema de Base de Datos');

    // Simular posición de scroll del usuario en la lista (ej. 540px)
    simulatedScrollY = 540;

    // Entrar al detalle de la subtarea usando su slug
    fireEvent.click(subtaskRow);

    // Estamos en TaskDetail de la subtarea
    expect(await screen.findByRole('heading', { name: 'Esquema de Base de Datos' })).toBeTruthy();

    // Simulamos que en la vista de detalle el scroll cambió a 0
    simulatedScrollY = 0;

    // Volver a la lista de tareas
    fireEvent.click(screen.getByRole('button', { name: /Volver a tareas/i }));

    // Verificar que las tareas expandidas siguen expandidas
    expect(await screen.findByText('Esquema de Base de Datos')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Contraer subtareas de Diseño del Sistema' }).getAttribute('aria-expanded'),
    ).toBe('true');

    // Verificar que la búsqueda y los filtros permanecen como estaban
    expect((screen.getByPlaceholderText('Buscar por título o descripción…') as HTMLInputElement).value).toBe('Diseño');
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('IN_PROGRESS');

    // Verificar que se restauró exactamente el scroll (540px)
    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalledWith(0, 540);
      expect(simulatedScrollY).toBe(540);
    });
  });

  it('10) no restaura un scroll antiguo cuando se ingresa por primera vez a un proyecto diferente', async () => {
    const taskProj1 = makeTask({
      id: 't-p1',
      projectId: 'project-1',
      title: 'Tarea Proyecto 1',
      subtaskCount: 1,
      completedSubtaskCount: 0,
    });
    const taskProj2 = makeTask({
      id: 't-p2',
      projectId: 'project-2',
      title: 'Tarea Proyecto 2',
      subtaskCount: 1,
      completedSubtaskCount: 0,
    });

    let simulatedScrollY = 620;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => simulatedScrollY,
    });
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'object' && first !== null && 'top' in first) {
        simulatedScrollY = (first as { top?: number }).top ?? 0;
      } else if (typeof args[1] === 'number') {
        simulatedScrollY = args[1];
      }
    });

    const { client, unmount } = setupRender([taskProj1]);

    // Expandir tarea y navegar al detalle en project-1 con scroll 620
    vi.spyOn(api, 'getSubtasks').mockResolvedValue([
      makeTask({ id: 's-p1', parentTaskId: 't-p1', title: 'Sub Proyecto 1' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Expandir subtareas de Tarea Proyecto 1' }));
    fireEvent.click(screen.getByText('Tarea Proyecto 1'));
    unmount();

    // Ahora ingresamos por primera vez a un proyecto diferente ('project-2')
    scrollToSpy.mockClear();
    client.setQueryData(['project', 'project-2'], {
      id: 'project-2',
      slug: 'proyecto-dos',
      name: 'Proyecto Dos',
      leaderId: 'user-1',
      leader: { id: 'user-1', name: 'Diana Paz', email: 'lider@tema.com', avatarUrl: null, active: true },
      estimatedEndDate: '2026-12-31',
    });
    client.setQueryData(['project-members', 'project-2'], []);
    client.setQueryData(['tasks', { projectId: 'project-2', page: 1, limit: 10 }, 'ALL'], taskPage([taskProj2]));

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TaskList projectId="project-2" onSelectTask={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Tarea Proyecto 2')).toBeTruthy();
    // No debe haber restaurado el scroll 620 del proyecto anterior, sino reiniciado a 0
    expect(scrollToSpy).not.toHaveBeenCalledWith(0, 620);
    expect(simulatedScrollY).toBe(0);
  });

  it('11) muestra flecha y contador automáticamente al crear la primera subtarea y los oculta al archivar/eliminar la última subtarea visible', async () => {
    let parentTask = makeTask({
      id: 't-dynamic',
      title: 'Tarea Sin Subtareas Iniciales',
      subtaskCount: 0,
      completedSubtaskCount: 0,
    });
    let subtasksList: Task[] = [];

    vi.spyOn(api, 'listTasks').mockImplementation(async () => taskPage([parentTask]));
    vi.spyOn(api, 'getSubtasks').mockImplementation(async () => subtasksList);
    vi.spyOn(api, 'createTask').mockImplementation(async (payload) => {
      const created = makeTask({
        id: 's-first',
        slug: 'primera-subtarea',
        parentTaskId: payload.parentTaskId ?? 't-dynamic',
        title: payload.title,
        status: 'PENDING',
      });
      subtasksList = [created];
      parentTask = { ...parentTask, subtaskCount: 1, completedSubtaskCount: 0 };
      return created;
    });

    const { client } = setupRender([parentTask]);

    // 1. Inicialmente tiene 0 subtareas -> no hay flecha ni contador 0/0
    expect(
      screen.queryByRole('button', { name: /Expandir subtareas de Tarea Sin Subtareas Iniciales/i }),
    ).toBeNull();
    expect(screen.queryByText('0/0')).toBeNull();

    // 2. Crear la primera subtarea desde "+ Subtarea"
    fireEvent.click(screen.getByRole('button', { name: 'Agregar subtarea a Tarea Sin Subtareas Iniciales' }));
    const dialog = screen.getByRole('dialog', { name: 'Nueva subtarea de Tarea Sin Subtareas Iniciales' });
    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Primera Subtarea' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear tarea' }));

    expect(await within(dialog).findByText('¡Subtarea creada!')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));

    // 3. Aparecen automáticamente la flecha para expandir y el contador 0/1
    const expandBtn = await screen.findByRole('button', {
      name: 'Expandir subtareas de Tarea Sin Subtareas Iniciales',
    });
    expect(expandBtn).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy();

    // Expandimos la tarea y vemos la subtarea creada
    fireEvent.click(expandBtn);
    expect(await screen.findByText('Primera Subtarea')).toBeTruthy();

    // 4. Se archiva la última subtarea visible -> desaparecen automáticamente la flecha, el contador y el panel desplegable
    subtasksList = [
      {
        ...subtasksList[0]!,
        archivedAt: '2026-10-18T15:00:00Z',
      },
    ];
    parentTask = { ...parentTask, subtaskCount: 0, completedSubtaskCount: 0 };
    await client.invalidateQueries({ queryKey: ['subtasks'] });
    await client.invalidateQueries({ queryKey: ['tasks'] });

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: / subtareas de Tarea Sin Subtareas Iniciales/i }),
      ).toBeNull();
      expect(screen.queryByText('0/1')).toBeNull();
      expect(screen.queryByText('0/0')).toBeNull();
      expect(screen.queryByRole('region', { name: 'Subtareas de Tarea Sin Subtareas Iniciales' })).toBeNull();
    });
  });

  it('12) filtra "Solo tareas con subtareas" usando subtaskCount sin nuevas consultas, lo combina con otros filtros/búsqueda y muestra estado vacío si no hay resultados', async () => {
    const taskWithSubtasksA = makeTask({
      id: 't1',
      title: 'Migración de base de datos',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignedToId: 'user-1',
      subtaskCount: 2,
      completedSubtaskCount: 1,
    });
    const taskWithSubtasksB = makeTask({
      id: 't2',
      title: 'Diseño de componentes',
      status: 'PENDING',
      priority: 'MEDIUM',
      assignedToId: 'user-2',
      subtaskCount: 1,
      completedSubtaskCount: 0,
    });
    const taskWithoutSubtasks = makeTask({
      id: 't3',
      title: 'Configurar entorno local',
      status: 'IN_PROGRESS',
      priority: 'LOW',
      assignedToId: 'user-1',
      subtaskCount: 0,
      completedSubtaskCount: 0,
    });

    const getSubtasksSpy = vi.spyOn(api, 'getSubtasks').mockResolvedValue([]);
    const listTasksSpy = vi.spyOn(api, 'listTasks').mockImplementation(async (filters) => {
      return taskPage([taskWithSubtasksA, taskWithSubtasksB, taskWithoutSubtasks].filter((t) => {
        if (filters.myTasks && t.assignedToId !== currentUser.id) return false;
        if (filters.status && t.status !== filters.status) return false;
        if (filters.priority && t.priority !== filters.priority) return false;
        if (filters.search && !t.title.toLowerCase().includes(filters.search.toLowerCase())) return false;
        return true;
      }));
    });

    setupRender([taskWithSubtasksA, taskWithSubtasksB, taskWithoutSubtasks]);

    const checkbox = screen.getByRole('checkbox', { name: 'Solo tareas con subtareas' }) as HTMLInputElement;
    // Desmarcado por defecto: muestra todas las tareas
    expect(checkbox.checked).toBe(false);
    expect(screen.getByText('Migración de base de datos')).toBeTruthy();
    expect(screen.getByText('Diseño de componentes')).toBeTruthy();
    expect(screen.getByText('Configurar entorno local')).toBeTruthy();

    // Marcado: se aplica automáticamente y muestra solo tareas con subtaskCount > 0, sin consultar subtareas por tarea
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(screen.getByText('Migración de base de datos')).toBeTruthy();
    expect(screen.getByText('Diseño de componentes')).toBeTruthy();
    expect(screen.queryByText('Configurar entorno local')).toBeNull();
    expect(getSubtasksSpy).not.toHaveBeenCalled();
    expect(listTasksSpy).not.toHaveBeenCalled();

    // Combinación con filtro de estado (IN_PROGRESS): solo queda 'Migración de base de datos'
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0]!, { target: { value: 'IN_PROGRESS' } });

    await waitFor(() => {
      expect(screen.getByText('Migración de base de datos')).toBeTruthy();
      expect(screen.queryByText('Diseño de componentes')).toBeNull();
      expect(screen.queryByText('Configurar entorno local')).toBeNull();
    });

    // Combinación con búsqueda sin coincidencias con subtareas -> muestra el estado vacío habitual
    const searchInput = screen.getByPlaceholderText('Buscar por título o descripción…');
    fireEvent.change(searchInput, { target: { value: 'Configurar' } });

    expect(
      await screen.findByText('No se encontraron tareas con los filtros actuales.'),
    ).toBeTruthy();

    // Al desmarcar el checkbox, aparece 'Configurar entorno local' (que cumple IN_PROGRESS + búsqueda 'Configurar')
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(await screen.findByText('Configurar entorno local')).toBeTruthy();

    // Volvemos a marcar y usamos "Limpiar filtros" para verificar que también reinicia el checkbox
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));

    await waitFor(() => {
      expect(checkbox.checked).toBe(false);
      expect(screen.getByText('Migración de base de datos')).toBeTruthy();
      expect(screen.getByText('Diseño de componentes')).toBeTruthy();
      expect(screen.getByText('Configurar entorno local')).toBeTruthy();
    });
  });

  it('13) conserva el estado del checkbox "Solo tareas con subtareas" al abrir una tarea/subtarea y volver, y lo reinicia al cambiar de proyecto', async () => {
    const taskWithSubtasks = makeTask({
      id: 't1',
      slug: 'tarea-con-subtareas',
      title: 'Tarea Con Subtareas',
      subtaskCount: 1,
      completedSubtaskCount: 0,
    });
    const taskWithoutSubtasks = makeTask({
      id: 't2',
      slug: 'tarea-sin-subtareas',
      title: 'Tarea Sin Subtareas',
      subtaskCount: 0,
      completedSubtaskCount: 0,
    });
    const subtask = makeTask({
      id: 's1',
      slug: 'subtarea-detalle',
      parentTaskId: 't1',
      title: 'Subtarea Detalle',
      status: 'PENDING',
    });

    vi.spyOn(api, 'listTasks').mockResolvedValue(taskPage([taskWithSubtasks, taskWithoutSubtasks]));
    vi.spyOn(api, 'getSubtasks').mockResolvedValue([subtask]);

    let savedState: TaskListPersistedState | null = null;
    const { client, onSelectTask, unmount } = setupRender(
      [taskWithSubtasks, taskWithoutSubtasks],
      vi.fn(),
      {
        onPersistedStateChange: (state: TaskListPersistedState) => {
          savedState = state;
        },
      },
    );

    // Marcar "Solo tareas con subtareas" y expandir la tarea para navegar al detalle de su subtarea
    const checkbox = screen.getByRole('checkbox', { name: 'Solo tareas con subtareas' }) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(screen.queryByText('Tarea Sin Subtareas')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expandir subtareas de Tarea Con Subtareas' }));
    await screen.findByText('Subtarea Detalle');

    // Abrir el detalle de la subtarea (desmonta TaskList como ocurre en ProjectPage)
    fireEvent.click(screen.getByText('Subtarea Detalle'));
    expect(onSelectTask).toHaveBeenCalledWith('subtarea-detalle');
    expect((savedState as TaskListPersistedState | null)?.onlyWithSubtasks).toBe(true);
    unmount();

    // Volver del detalle al listado del mismo proyecto -> el checkbox sigue marcado y el filtro activo
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TaskList
            projectId={PROJECT_ID}
            onSelectTask={onSelectTask}
            persistedState={savedState}
            onPersistedStateChange={(state) => {
              savedState = state;
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const restoredCheckbox = screen.getByRole('checkbox', {
      name: 'Solo tareas con subtareas',
    }) as HTMLInputElement;
    expect(restoredCheckbox.checked).toBe(true);
    expect(screen.getByText('Tarea Con Subtareas')).toBeTruthy();
    expect(screen.queryByText('Tarea Sin Subtareas')).toBeNull();
    expect(await screen.findByText('Subtarea Detalle')).toBeTruthy();

    // Cambiar a un proyecto diferente ('project-2') -> el checkbox se reinicia a desmarcado
    const taskProj2 = makeTask({
      id: 't-proj-2',
      projectId: 'project-2',
      title: 'Tarea Sin Subtareas Proyecto 2',
      subtaskCount: 0,
      completedSubtaskCount: 0,
    });
    client.setQueryData(['project', 'project-2'], {
      id: 'project-2',
      slug: 'proyecto-dos',
      name: 'Proyecto Dos',
      leaderId: 'user-1',
      leader: { id: 'user-1', name: 'Diana Paz', email: 'lider@tema.com', avatarUrl: null, active: true },
      estimatedEndDate: '2026-12-31',
    });
    client.setQueryData(['project-members', 'project-2'], []);
    client.setQueryData(['tasks', { projectId: 'project-2', page: 1, limit: 10 }, 'ALL'], taskPage([taskProj2]));

    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TaskList projectId="project-2" onSelectTask={onSelectTask} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const resetCheckbox = screen.getByRole('checkbox', {
      name: 'Solo tareas con subtareas',
    }) as HTMLInputElement;
    expect(resetCheckbox.checked).toBe(false);
    expect(await screen.findByText('Tarea Sin Subtareas Proyecto 2')).toBeTruthy();
  });

  it('14) regresión: cuando una tarea tiene caché vacía desactualizada, al crear la primera subtarea la flecha y el contador 0/1 aparecen de inmediato sin recargar en tareas consecutivas y el filtro "Solo tareas con subtareas" las muestra', async () => {
    let taskA = makeTask({
      id: 'task-a',
      slug: 'tarea-a',
      title: 'Tarea Alpha',
      subtaskCount: 0,
      completedSubtaskCount: 0,
    });
    let taskB = makeTask({
      id: 'task-b',
      slug: 'tarea-b',
      title: 'Tarea Beta',
      subtaskCount: 0,
      completedSubtaskCount: 0,
    });

    const subtasksMap: Record<string, Task[]> = {
      'task-a': [],
      'task-b': [],
    };

    vi.spyOn(api, 'listTasks').mockImplementation(async () => taskPage([taskA, taskB]));
    vi.spyOn(api, 'getSubtasks').mockImplementation(async (taskId) => subtasksMap[taskId] ?? []);
    vi.spyOn(api, 'createTask').mockImplementation(async (payload) => {
      const pId = payload.parentTaskId!;
      const created = makeTask({
        id: `sub-${pId}`,
        slug: `sub-${pId}`,
        parentTaskId: pId,
        title: payload.title,
        status: 'PENDING',
      });
      subtasksMap[pId] = [created];
      if (pId === 'task-a') {
        taskA = { ...taskA, subtaskCount: 1, completedSubtaskCount: 0 };
      } else if (pId === 'task-b') {
        taskB = { ...taskB, subtaskCount: 1, completedSubtaskCount: 0 };
      }
      return created;
    });

    const { client } = setupRender([taskA, taskB]);

    // Escenario exacto del bug: el usuario visitó previamente el detalle de ambas tareas,
    // por lo que ambas tienen una caché de subtareas existente como array vacío [].
    client.setQueryData(['subtasks', 'task-a'], []);
    client.setQueryData(['subtasks', 'task-b'], []);

    // 1. Inicialmente no hay flechas ni badges
    expect(screen.queryByRole('button', { name: /Expandir subtareas de Tarea Alpha/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Expandir subtareas de Tarea Beta/i })).toBeNull();

    // 2. Crear subtarea en Tarea Alpha
    fireEvent.click(screen.getByRole('button', { name: 'Agregar subtarea a Tarea Alpha' }));
    const dialogA = screen.getByRole('dialog', { name: 'Nueva subtarea de Tarea Alpha' });
    fireEvent.change(within(dialogA).getByLabelText('Título *'), { target: { value: 'Subtarea Alpha 1' } });
    fireEvent.click(within(dialogA).getByRole('button', { name: 'Crear tarea' }));
    expect(await within(dialogA).findByText('¡Subtarea creada!')).toBeTruthy();
    fireEvent.click(within(dialogA).getByRole('button', { name: 'Cerrar' }));

    // 3. Flecha y contador 0/1 aparecen de inmediato para Tarea Alpha (sin recargar la página)
    const expandBtnA = await screen.findByRole('button', {
      name: 'Expandir subtareas de Tarea Alpha',
    });
    expect(expandBtnA).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy();

    // 4. Se expande Tarea Alpha y se ve su subtarea
    fireEvent.click(expandBtnA);
    expect(await screen.findByText('Subtarea Alpha 1')).toBeTruthy();

    // 5. Crear subtarea en la segunda tarea consecutiva (Tarea Beta)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar subtarea a Tarea Beta' }));
    const dialogB = screen.getByRole('dialog', { name: 'Nueva subtarea de Tarea Beta' });
    fireEvent.change(within(dialogB).getByLabelText('Título *'), { target: { value: 'Subtarea Beta 1' } });
    fireEvent.click(within(dialogB).getByRole('button', { name: 'Crear tarea' }));
    expect(await within(dialogB).findByText('¡Subtarea creada!')).toBeTruthy();
    fireEvent.click(within(dialogB).getByRole('button', { name: 'Cerrar' }));

    // 6. Flecha y contador 0/1 aparecen de inmediato para Tarea Beta
    const expandBtnB = await screen.findByRole('button', {
      name: 'Expandir subtareas de Tarea Beta',
    });
    expect(expandBtnB).toBeTruthy();
    const badges = screen.getAllByText('0/1');
    expect(badges.length).toBe(2);

    // 7. Se expande Tarea Beta y se ve su subtarea
    fireEvent.click(expandBtnB);
    expect(await screen.findByText('Subtarea Beta 1')).toBeTruthy();

    // 8. El filtro "Solo tareas con subtareas" las muestra correctamente sin ser bloqueado por la caché previa
    const filterCheckbox = screen.getByRole('checkbox', {
      name: 'Solo tareas con subtareas',
    }) as HTMLInputElement;
    fireEvent.click(filterCheckbox);
    expect(filterCheckbox.checked).toBe(true);

    expect(screen.getByText('Tarea Alpha')).toBeTruthy();
    expect(screen.getByText('Tarea Beta')).toBeTruthy();
  });
});
