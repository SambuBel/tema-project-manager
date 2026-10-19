import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useMyMembership } from '../hooks/useMyMembership';
import { canCreateTaskUI } from '../lib/permissions';
import { SubtaskCreateModal } from './SubtaskCreateModal';
import { CreateTaskDrawer } from './CreateTaskDrawer';
import type { Task, TaskStatus, TaskPriority, TaskFilters } from '../types/task';
import { taskStatusLabels, taskPriorityLabels } from '../types/task';
import { isTaskExceedingProjectEnd } from '../lib/projectDates';

const statusColors: Record<TaskStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  IN_REVIEW: 'bg-purple-50 text-purple-700',
  BLOCKED: 'bg-red-50 text-red-700',
  COMPLETED: 'bg-green-50 text-green-700'
};

const priorityColors: Record<TaskPriority, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-amber-50 text-amber-700',
  HIGH: 'bg-red-50 text-red-700',
  CRITICAL: 'bg-red-100 text-red-800',
};

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return dateStr;
  }
}

/** Devuelve true si la tarea está vencida (dueDate pasó y no está completada/cancelada). */
function isOverdue(task: Task): boolean {
  if (!task.dueDate) return false;
  if (task.status === 'COMPLETED') return false;
  return new Date(task.dueDate) < new Date();
}

/** "En riesgo" = vencida O bloqueada. */
function isAtRisk(task: Task): boolean {
  return isOverdue(task) || task.status === 'BLOCKED';
}

function getWindowScrollTop(): number {
  if (typeof window === 'undefined') return 0;
  return window.scrollY || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
}

function setWindowScrollTop(top: number): void {
  if (typeof window === 'undefined') return;
  if (document.documentElement) {
    document.documentElement.scrollTop = top;
  }
  if (document.body) {
    document.body.scrollTop = top;
  }
  try {
    window.scrollTo(0, top);
  } catch {
    // En entornos de test sin mock de scrollTo puede no estar implementado
  }
}

/* Tipos */

export type ViewFilter = 'ALL' | 'AT_RISK' | 'MINE';

export interface TaskListPersistedState {
  projectId: string;
  filters: TaskFilters;
  searchInput: string;
  viewFilter: ViewFilter;
  onlyWithSubtasks?: boolean;
  expandedTasks: Record<string, boolean>;
  scrollTop: number | null;
}

/* Props */

interface TaskListProps {
  projectId: string;
  onSelectTask: (taskId: string) => void;
  persistedState?: TaskListPersistedState | null;
  onPersistedStateChange?: (state: TaskListPersistedState) => void;
}

interface TaskRowProps {
  task: Task;
  isExpanded: boolean;
  onToggleExpand: (taskId: string) => void;
  onSelectTask: (taskIdentifier: string) => void;
  canCreateSubtask: boolean;
  onAddSubtask: (task: Task) => void;
  projectEstimatedEndDate?: string | null;
}

function TaskRow({
  task,
  isExpanded,
  onToggleExpand,
  onSelectTask,
  canCreateSubtask,
  onAddSubtask,
  projectEstimatedEndDate,
}: TaskRowProps) {
  const backendSubtaskCount = task.subtaskCount ?? 0;
  const backendCompletedCount = task.completedSubtaskCount ?? 0;

  const subtasksQuery = useQuery({
    queryKey: ['subtasks', task.id],
    queryFn: () => api.getSubtasks(task.id),
    enabled: isExpanded && backendSubtaskCount > 0,
  });

  const subtasks = subtasksQuery.data;
  const activeSubtasks = subtasks ? subtasks.filter((s) => !s.archivedAt) : undefined;
  const totalSubtasks = isExpanded && subtasksQuery.isSuccess && activeSubtasks
    ? activeSubtasks.length
    : Math.max(backendSubtaskCount, activeSubtasks?.length ?? 0);
  const completedSubtasks = isExpanded && subtasksQuery.isSuccess && activeSubtasks
    ? activeSubtasks.filter((s) => s.status === 'COMPLETED').length
    : activeSubtasks && activeSubtasks.length > 0
      ? activeSubtasks.filter((s) => s.status === 'COMPLETED').length
      : backendCompletedCount;
  const hasSubtasks = totalSubtasks > 0;
  const showExpanded = isExpanded && hasSubtasks;

  // Si se archiva o elimina la última subtarea visible mientras estaba expandida, contraer automáticamente
  useEffect(() => {
    if (isExpanded && !hasSubtasks && !subtasksQuery.isLoading && !subtasksQuery.isError) {
      onToggleExpand(task.id);
    }
  }, [isExpanded, hasSubtasks, subtasksQuery.isLoading, subtasksQuery.isError, onToggleExpand, task.id]);

  return (
    <div className="border-b border-[#DEE5EC] last:border-b-0">
      <div className="flex items-center transition-colors hover:bg-[#EAF2F7]/40">
        <div
          className="flex w-10 shrink-0 items-center justify-center pl-3"
          aria-hidden={!hasSubtasks ? 'true' : undefined}
        >
          {hasSubtasks && (
            <button
              type="button"
              onClick={() => onToggleExpand(task.id)}
              aria-expanded={showExpanded}
              aria-controls={`subtasks-panel-${task.id}`}
              aria-label={(showExpanded ? 'Contraer subtareas de ' : 'Expandir subtareas de ') + task.title}
              title={showExpanded ? 'Contraer subtareas' : 'Expandir subtareas'}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[#607185] transition-colors hover:bg-[#EAF2F7] hover:text-[#245B78] focus:outline-none focus:ring-2 focus:ring-[#245B78]/30"
            >
              <svg
                className={`h-4 w-4 transition-transform duration-150 motion-reduce:transition-none ${
                  showExpanded ? 'rotate-90 text-[#245B78]' : ''
                }`}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => onSelectTask(task.slug || task.id)}
          className="grid min-w-0 flex-1 grid-cols-[1fr_120px_120px_110px_100px] items-center gap-2 py-3.5 pl-1 pr-5 text-left"
        >
          {/* Tarea */}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium text-[#172B42]">{task.title}</p>
              {hasSubtasks && (
                <span
                  className="shrink-0 rounded-full bg-[#EAF2F7] px-2 py-0.5 text-xs font-medium text-[#245B78]"
                  title={`Subtareas completadas: ${completedSubtasks} de ${totalSubtasks}`}
                  aria-label={`Subtareas completadas: ${completedSubtasks} de ${totalSubtasks}`}
                >
                  {completedSubtasks}/{totalSubtasks}
                </span>
              )}
              {/* Condición adicional, NO un TaskStatus: el estado real se sigue mostrando en su columna. */}
              {task.archivedAt && (
                <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                  Archivada
                </span>
              )}
            </div>
            {task.description && (
              <p className="mt-0.5 truncate text-xs text-[#607185]">{task.description}</p>
            )}
          </div>

          {/* Responsable */}
          <div className="flex items-center">
            {task.assignedTo ? (
              <div className="flex items-center gap-2">
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EAF2F7] text-[10px] font-semibold text-[#245B78]"
                  title={task.assignedTo.name}
                >
                  {initials(task.assignedTo.name)}
                </div>
                <span className="hidden truncate text-xs text-[#172B42] lg:inline">
                  {task.assignedTo.name.split(' ')[0]}
                </span>
              </div>
            ) : (
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-[#DEE5EC] text-[10px] text-[#607185]"
                title="Sin asignar"
              >
                —
              </div>
            )}
          </div>

          {/* Estado */}
          <div>
            <span className={'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ' + statusColors[task.status]}>
              {taskStatusLabels[task.status]}
            </span>
          </div>

          {/* Prioridad */}
          <div>
            <span className={'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ' + priorityColors[task.priority]}>
              {taskPriorityLabels[task.priority]}
            </span>
          </div>

          {/* Vencimiento */}
          <div>
            <span className={'text-xs ' + (isOverdue(task) ? 'font-semibold text-red-600' : 'text-[#607185]')}>
              {isOverdue(task) && '⚠️ '}
              {formatDate(task.dueDate)}
            </span>
            {isTaskExceedingProjectEnd(task.dueDate, projectEstimatedEndDate) && (
              <span
                className="block text-[10px] font-medium text-amber-700"
                title="El vencimiento supera el fin estimado del proyecto (RN-08)"
              >
                ⚠️ Supera fin proy.
              </span>
            )}
          </div>
        </button>

        {canCreateSubtask && (
          <div className="w-[130px] shrink-0 pr-5">
            {!task.archivedAt && (
              <button
                type="button"
                onClick={() => onAddSubtask(task)}
                title={'Agregar subtarea a ' + task.title}
                aria-label={'Agregar subtarea a ' + task.title}
                className="w-full rounded-lg border border-[#DEE5EC] bg-white px-3 py-1.5 text-xs font-medium text-[#245B78] transition-colors hover:bg-[#EAF2F7]"
              >
                + Subtarea
              </button>
            )}
          </div>
        )}
      </div>

      {/* Desplegable de subtareas */}
      {showExpanded && (
        <div
          id={`subtasks-panel-${task.id}`}
          role="region"
          aria-label={'Subtareas de ' + task.title}
          className="border-t border-[#DEE5EC]/70 bg-[#F7F9FB]"
        >
          {subtasksQuery.isLoading && (
            <p className="py-3 pl-11 pr-5 text-xs text-[#607185]">Cargando subtareas…</p>
          )}

          {subtasksQuery.isError && (
            <p role="alert" className="py-3 pl-11 pr-5 text-xs text-red-600">
              Error al cargar las subtareas.
            </p>
          )}

          {subtasksQuery.isSuccess && activeSubtasks && activeSubtasks.length > 0 && (
            <div className="divide-y divide-[#DEE5EC]/60">
              {activeSubtasks.map((subtask) => (
                <div
                  key={subtask.id}
                  className="flex items-center transition-colors hover:bg-[#EAF2F7]/50"
                >
                  <div className="w-10 shrink-0 pl-3" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => onSelectTask(subtask.slug || subtask.id)}
                    className="grid min-w-0 flex-1 grid-cols-[1fr_120px_120px_110px_100px] items-center gap-2 py-2.5 pl-1 pr-5 text-left"
                  >
                    {/* Subtarea indentada */}
                    <div className="min-w-0 border-l-2 border-[#245B78]/25 pl-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-xs text-[#607185]" aria-hidden="true">
                          ↳
                        </span>
                        <p
                          className={
                            'truncate text-xs font-medium ' +
                            (subtask.status === 'COMPLETED'
                              ? 'line-through text-[#607185]'
                              : 'text-[#172B42]')
                          }
                        >
                          {subtask.title}
                        </p>
                        {subtask.archivedAt && (
                          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                            Archivada
                          </span>
                        )}
                      </div>
                      {subtask.description && (
                        <p className="mt-0.5 truncate pl-4 text-[11px] text-[#607185]">
                          {subtask.description}
                        </p>
                      )}
                    </div>

                    {/* Responsable */}
                    <div className="flex items-center">
                      {subtask.assignedTo ? (
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EAF2F7] text-[10px] font-semibold text-[#245B78]"
                            title={subtask.assignedTo.name}
                          >
                            {initials(subtask.assignedTo.name)}
                          </div>
                          <span className="hidden truncate text-xs text-[#172B42] lg:inline">
                            {subtask.assignedTo.name.split(' ')[0]}
                          </span>
                        </div>
                      ) : (
                        <div
                          className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-[#DEE5EC] text-[10px] text-[#607185]"
                          title="Sin asignar"
                        >
                          —
                        </div>
                      )}
                    </div>

                    {/* Estado */}
                    <div>
                      <span
                        className={
                          'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ' +
                          statusColors[subtask.status]
                        }
                      >
                        {taskStatusLabels[subtask.status]}
                      </span>
                    </div>

                    {/* Prioridad */}
                    <div>
                      <span
                        className={
                          'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ' +
                          priorityColors[subtask.priority]
                        }
                      >
                        {taskPriorityLabels[subtask.priority]}
                      </span>
                    </div>

                    {/* Vencimiento */}
                    <div>
                      <span
                        className={
                          'text-xs ' +
                          (isOverdue(subtask) ? 'font-semibold text-red-600' : 'text-[#607185]')
                        }
                      >
                        {isOverdue(subtask) && '⚠️ '}
                        {formatDate(subtask.dueDate)}
                      </span>
                      {isTaskExceedingProjectEnd(subtask.dueDate, projectEstimatedEndDate) && (
                        <span
                          className="block text-[10px] font-medium text-amber-700"
                          title="El vencimiento supera el fin estimado del proyecto (RN-08)"
                        >
                          ⚠️ Supera fin proy.
                        </span>
                      )}
                    </div>
                  </button>
                  {canCreateSubtask && <div className="w-[130px] shrink-0 pr-5" aria-hidden="true" />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* Componente */

/**
 * Lista de tareas de un proyecto en formato tabla.
 */
export function TaskList({
  projectId,
  onSelectTask,
  persistedState,
  onPersistedStateChange,
}: TaskListProps) {
  const qc = useQueryClient();
  const { user: currentUser } = useCurrentUser();

  const initialRestoredState = persistedState && persistedState.projectId === projectId
    ? persistedState
    : null;

  const [filters, setFilters] = useState<TaskFilters>(
    () => initialRestoredState?.filters ?? { projectId },
  );
  const [searchInput, setSearchInput] = useState<string>(
    () => initialRestoredState?.searchInput ?? '',
  );
  const [viewFilter, setViewFilter] = useState<ViewFilter>(
    () => initialRestoredState?.viewFilter ?? 'ALL',
  );
  const [onlyWithSubtasks, setOnlyWithSubtasks] = useState<boolean>(
    () => initialRestoredState?.onlyWithSubtasks ?? false,
  );
  const [subtaskParent, setSubtaskParent] = useState<Task | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>(
    () => initialRestoredState?.expandedTasks ?? {},
  );
  const [pendingScrollTop, setPendingScrollTop] = useState<number | null>(
    () => initialRestoredState?.scrollTop ?? null,
  );

  const prevProjectIdRef = useRef(projectId);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const fetchingSubtasksCount = useIsFetching({ queryKey: ['subtasks'] });

  // Si se monta por primera vez sin scroll previo restaurado para este proyecto, asegurar scroll en 0
  useEffect(() => {
    if (initialRestoredState?.scrollTop === null || initialRestoredState?.scrollTop === undefined) {
      setWindowScrollTop(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si cambia la prop projectId sobre la misma instancia montada, reiniciar el estado para el nuevo proyecto
  useEffect(() => {
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      setFilters({ projectId });
      setSearchInput('');
      setViewFilter('ALL');
      setOnlyWithSubtasks(false);
      setExpandedTasks({});
      setPendingScrollTop(null);
      setWindowScrollTop(0);
    }
  }, [projectId]);

  // Sincronizar cambios de estado con el contenedor padre (ProjectPage)
  useEffect(() => {
    const nextSnapshot: TaskListPersistedState = {
      projectId,
      filters,
      searchInput,
      viewFilter,
      onlyWithSubtasks,
      expandedTasks,
      scrollTop: pendingScrollTop,
    };
    onPersistedStateChange?.(nextSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filters, searchInput, viewFilter, onlyWithSubtasks, expandedTasks, pendingScrollTop]);

  const toggleExpand = (taskId: string) => {
    setExpandedTasks((prev) => {
      const nextExpanded = !prev[taskId];
      if (nextExpanded) {
        const taskObj = tasks.data?.find((t) => t.id === taskId);
        const cachedSubtasks = qc.getQueryData<Task[]>(['subtasks', taskId]);
        const activeCachedCount = cachedSubtasks
          ? cachedSubtasks.filter((s) => !s.archivedAt).length
          : 0;
        const availableCount = Math.max(taskObj?.subtaskCount ?? 0, activeCachedCount);
        if (availableCount <= 0) {
          return prev;
        }
      }
      return { ...prev, [taskId]: nextExpanded };
    });
  };

  const handleSelectTask = (taskIdentifier: string) => {
    const currentScrollTop = getWindowScrollTop();
    const effectiveFilters: TaskFilters = searchInput
      ? { ...filters, search: searchInput }
      : filters;
    const snapshot: TaskListPersistedState = {
      projectId,
      filters: effectiveFilters,
      searchInput,
      viewFilter,
      onlyWithSubtasks,
      expandedTasks,
      scrollTop: currentScrollTop,
    };
    onPersistedStateChange?.(snapshot);
    onSelectTask(taskIdentifier);
  };

  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.getProject(projectId) });
  const members = useQuery({ queryKey: ['project-members', projectId], queryFn: () => api.getProjectMembers(projectId) });

  /* Responsables posibles para el filtro: lider + miembros activos, sin repetidos. */
  const assignees = new Map<string, { id: string; name: string }>();
  if (project.data?.leader) assignees.set(project.data.leader.id, project.data.leader);
  for (const member of members.data ?? []) {
    if (member.user) assignees.set(member.user.id, member.user);
  }

  const tasks = useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => api.listTasks(filters),
  });

  const { membership } = useMyMembership(projectId);
  const canCreateSubtask = !!currentUser && !!project.data && canCreateTaskUI(currentUser, project.data, membership);

  /* Búsqueda por texto: se aplica sola 300 ms después de dejar de escribir (sin botón "Buscar"). */
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput || undefined;
      setFilters((prev) => (prev.search === next ? prev : { ...prev, search: next }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /* Estado, prioridad y responsable se aplican apenas se elige una opción. */
  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as TaskStatus | '';
    setFilters((prev) => ({ ...prev, status: value || undefined }));
  };

  const handlePriorityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as TaskPriority | '';
    setFilters((prev) => ({ ...prev, priority: value || undefined }));
  };

  const handleAssigneeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setFilters((prev) => ({ ...prev, assignedToId: value || undefined }));
  };

  const clearFilters = () => {
    setFilters({ projectId });
    setSearchInput('');
    setViewFilter('ALL');
    setOnlyWithSubtasks(false);
  };

  const hasActiveFilters = !!(
    filters.status ||
    filters.priority ||
    filters.search ||
    filters.assignedToId ||
    onlyWithSubtasks
  );

  /* "Mis tareas", "En riesgo" y "Solo tareas con subtareas" se aplican sobre los datos ya cargados (client-side):
     comparten la misma consulta que "Todas", sin disparar nuevas peticiones por tarea. */
  const isMine = (task: Task): boolean => !!currentUser && task.assignedToId === currentUser.id;
  const hasSubtasksForFilter = (task: Task): boolean => {
    const cachedSubtasks = qc.getQueryData<Task[]>(['subtasks', task.id]);
    const activeCachedCount = cachedSubtasks
      ? cachedSubtasks.filter((s) => !s.archivedAt).length
      : 0;
    const effectiveCount = Math.max(task.subtaskCount ?? 0, activeCachedCount);
    return effectiveCount > 0;
  };

  const visibleTasks: Task[] = (() => {
    if (!tasks.data) return [];
    let list = tasks.data;
    if (viewFilter === 'AT_RISK') list = list.filter(isAtRisk);
    else if (viewFilter === 'MINE') list = list.filter(isMine);
    if (onlyWithSubtasks) list = list.filter(hasSubtasksForFilter);
    return list;
  })();

  // Restauración determinística del scroll una vez que la lista y las subtareas expandidas están disponibles en el DOM
  useEffect(() => {
    if (pendingScrollTop === null) return;
    if (!tasks.isSuccess) return;
    if (visibleTasks.length > 0 && !tableContainerRef.current) return;

    const expandedVisibleIds = visibleTasks
      .filter((t) => expandedTasks[t.id] && (t.subtaskCount ?? 0) > 0)
      .map((t) => t.id);

    const allExpandedSubtasksReady = expandedVisibleIds.every((id) => {
      const state = qc.getQueryState(['subtasks', id]);
      return state?.data !== undefined || state?.status === 'error';
    });

    if (!allExpandedSubtasksReady) return;

    setWindowScrollTop(pendingScrollTop);
    setPendingScrollTop(null);
  }, [
    pendingScrollTop,
    tasks.isSuccess,
    visibleTasks,
    expandedTasks,
    fetchingSubtasksCount,
    projectId,
    qc,
  ]);

  const totalCount = tasks.data?.length ?? 0;
  const atRiskCount = tasks.data?.filter(isAtRisk).length ?? 0;
  const mineCount = tasks.data?.filter(isMine).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Toggle Todas / Mis tareas / En riesgo */}
      <div className="flex items-center gap-3">
        <button
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            viewFilter === 'ALL'
              ? 'bg-[#245B78] text-white'
              : 'border border-[#DEE5EC] bg-white text-[#607185] hover:bg-[#EAF2F7]'
          }`}
          onClick={() => setViewFilter('ALL')}
        >
          Todas ({totalCount})
        </button>
        <button
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            viewFilter === 'MINE'
              ? 'bg-[#245B78] text-white'
              : 'border border-[#DEE5EC] bg-white text-[#607185] hover:bg-[#EAF2F7]'
          }`}
          onClick={() => setViewFilter('MINE')}
        >
          Mis tareas ({mineCount})
        </button>
        <button
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            viewFilter === 'AT_RISK'
              ? 'bg-red-600 text-white'
              : 'border border-[#DEE5EC] bg-white text-[#607185] hover:bg-red-50'
          }`}
          onClick={() => setViewFilter('AT_RISK')}
        >
          En riesgo ({atRiskCount})
        </button>

        {/* Alta de tareas: nunca puede -> no se renderiza (no solo deshabilitado) */}
        {canCreateSubtask && (
          <button
            type="button"
            onClick={() => setCreatingTask(true)}
            className="ml-auto rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#1a445b]"
          >
            Nueva tarea
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-[#DEE5EC] bg-white p-4">
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-wrap items-center gap-3">
          <input
            className="min-w-[200px] flex-1 rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm placeholder:text-[#607185] focus:border-[#245B78] focus:outline-none"
            placeholder="Buscar por título o descripción…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />

          <select
            className="rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none"
            value={filters.status ?? ''}
            onChange={handleStatusChange}
          >
            <option value="">Estado: Todos</option>
            {Object.entries(taskStatusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          <select
            className="rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none"
            value={filters.priority ?? ''}
            onChange={handlePriorityChange}
          >
            <option value="">Prioridad: Todas</option>
            {Object.entries(taskPriorityLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          <select
            className="rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none"
            value={filters.assignedToId ?? ''}
            onChange={handleAssigneeChange}
          >
            <option value="">Responsable: Todos</option>
            {[...assignees.values()].map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          <label className="flex cursor-pointer select-none items-center gap-2 rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm text-[#172B42] transition-colors hover:bg-[#EAF2F7]/50">
            <input
              type="checkbox"
              checked={onlyWithSubtasks}
              onChange={(e) => setOnlyWithSubtasks(e.target.checked)}
              className="h-4 w-4 rounded border-[#DEE5EC] text-[#245B78] focus:ring-[#245B78]"
            />
            <span>Solo tareas con subtareas</span>
          </label>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm text-[#607185] hover:bg-gray-50"
            >
              Limpiar filtros
            </button>
          )}
        </form>
      </div>

      {/* Loading */}
      {tasks.isLoading && (
        <p className="text-sm text-[#607185]">Cargando tareas…</p>
      )}

      {/* Error */}
      {tasks.isError && (
        <p className="text-sm text-red-600">Error al cargar las tareas.</p>
      )}

      {/* Empty */}
      {tasks.isSuccess && visibleTasks.length === 0 && (
        <div className="rounded-xl border border-[#DEE5EC] bg-white p-8 text-center">
          <p className="text-sm text-[#607185]">
            {hasActiveFilters &&
            (viewFilter === 'ALL' ||
              (viewFilter === 'AT_RISK' && atRiskCount > 0) ||
              (viewFilter === 'MINE' && mineCount > 0))
              ? 'No se encontraron tareas con los filtros actuales.'
              : viewFilter === 'AT_RISK'
                ? 'No hay tareas en riesgo. ¡Todo en orden!'
                : viewFilter === 'MINE'
                  ? 'No tenés tareas asignadas acá.'
                  : 'Este proyecto todavía no tiene tareas.'}
          </p>
        </div>
      )}

      {/* Tabla de tareas */}
      {tasks.isSuccess && visibleTasks.length > 0 && (
        <div
          ref={tableContainerRef}
          className="overflow-hidden rounded-xl border border-[#DEE5EC] bg-white"
        >
          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              {/* Header */}
              <div className="flex items-center border-b border-[#DEE5EC] bg-[#F7F9FB] text-xs font-semibold uppercase tracking-wide text-[#607185]">
                <div className="w-10 shrink-0 pl-3" aria-hidden="true" />
                <div className="grid min-w-0 flex-1 grid-cols-[1fr_120px_120px_110px_100px] items-center gap-2 py-3 pl-1 pr-5">
                  <span>Tarea</span>
                  <span>Responsable</span>
                  <span>Estado</span>
                  <span>Prioridad</span>
                  <span>Vencimiento</span>
                </div>
                {canCreateSubtask && <div className="w-[130px] shrink-0 pr-5" aria-hidden="true" />}
              </div>

              {/* Rows */}
              {visibleTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isExpanded={!!expandedTasks[task.id]}
                  onToggleExpand={toggleExpand}
                  onSelectTask={handleSelectTask}
                  canCreateSubtask={canCreateSubtask}
                  onAddSubtask={setSubtaskParent}
                  projectEstimatedEndDate={project.data?.estimatedEndDate}
                />
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[#DEE5EC] bg-[#F7F9FB] px-5 py-2.5 text-xs text-[#607185]">
            <span>
              {viewFilter === 'AT_RISK'
                ? visibleTasks.length + ' tarea' + (visibleTasks.length !== 1 ? 's' : '') + ' en riesgo'
                : viewFilter === 'MINE'
                  ? visibleTasks.length + ' tarea' + (visibleTasks.length !== 1 ? 's' : '') + ' asignada' + (visibleTasks.length !== 1 ? 's' : '') + ' a vos'
                  : visibleTasks.length + ' tarea' + (visibleTasks.length !== 1 ? 's' : '')}
            </span>
            {hasActiveFilters && (
              <span className="italic">Filtros activos</span>
            )}
          </div>
        </div>
      )}

      {subtaskParent && (
        <SubtaskCreateModal
          projectId={projectId}
          parentTask={{ id: subtaskParent.id, title: subtaskParent.title }}
          onClose={() => setSubtaskParent(null)}
        />
      )}

      {creatingTask && <CreateTaskDrawer projectId={projectId} onClose={() => setCreatingTask(false)} />}
    </div>
  );
}