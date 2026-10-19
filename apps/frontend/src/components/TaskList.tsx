import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useMyMembership } from '../hooks/useMyMembership';
import { canCreateTaskUI } from '../lib/permissions';
import { SubtaskCreateModal } from './SubtaskCreateModal';
import type { Task, TaskStatus, TaskPriority, TaskFilters } from '../types/task';
import { taskStatusLabels, taskPriorityLabels } from '../types/task';
import { isTaskExceedingProjectEnd } from '../lib/projectDates';
import { Pagination } from './Pagination';

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

/* Tipos */

type ViewFilter = 'ALL' | 'AT_RISK' | 'MINE';

/* Props */

interface TaskListProps {
  projectId: string;
  onSelectTask: (taskId: string) => void;
}

/* Componente */

/**
 * Lista de tareas de un proyecto en formato tabla.
 */
export function TaskList({ projectId, onSelectTask }: TaskListProps) {
  const { user: currentUser } = useCurrentUser();
  const [filters, setFilters] = useState<TaskFilters>({ projectId, page: 1, limit: 10 });
  const [searchInput, setSearchInput] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('ALL');
  const [subtaskParent, setSubtaskParent] = useState<Task | null>(null);

  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.getProject(projectId) });
  const members = useQuery({ queryKey: ['project-members', projectId], queryFn: () => api.getProjectMembers(projectId) });

  /* Responsables posibles para el filtro: lider + miembros activos, sin repetidos. */
  const assignees = new Map<string, { id: string; name: string }>();
  if (project.data?.leader) assignees.set(project.data.leader.id, project.data.leader);
  for (const member of members.data ?? []) {
    if (member.user) assignees.set(member.user.id, member.user);
  }

    const tasks = useQuery({
    queryKey: ['tasks', filters, viewFilter],
    queryFn: () => api.listTasks({
      ...filters,
      myTasks: viewFilter === 'MINE' ? true : undefined,
      atRisk: viewFilter === 'AT_RISK' ? true : undefined,
    }),
    placeholderData: keepPreviousData,
  });

  const { membership } = useMyMembership(projectId);
  const canCreateSubtask = !!currentUser && !!project.data && canCreateTaskUI(currentUser, project.data, membership);

  /* Búsqueda por texto: se aplica sola 300 ms después de dejar de escribir (sin botón "Buscar"). */
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput || undefined;
      setFilters((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /* Estado, prioridad y responsable se aplican apenas se elige una opción. */
  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as TaskStatus | '';
    setFilters((prev) => ({ ...prev, status: value || undefined, page: 1 }));
  };

  const handlePriorityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as TaskPriority | '';
    setFilters((prev) => ({ ...prev, priority: value || undefined, page: 1 }));
  };

  const handleAssigneeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setFilters((prev) => ({ ...prev, assignedToId: value || undefined, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({ projectId, page: 1, limit: 10 });
    setSearchInput('');
    setViewFilter('ALL');
  };

  const hasActiveFilters = !!(filters.status || filters.priority || filters.search || filters.assignedToId);

    /* Los datos ya vienen filtrados y paginados del backend. */
  const visibleTasks: Task[] = tasks.data?.data ?? [];
  const counts = tasks.data?.counts ?? { all: 0, mine: 0, atRisk: 0 };
  const totalPages = tasks.data?.totalPages ?? 1;

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
          onClick={() => { setViewFilter('ALL'); setFilters((prev) => ({ ...prev, page: 1 })); }}
        >
          Todas ({counts.all})
        </button>
        <button
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            viewFilter === 'MINE'
              ? 'bg-[#245B78] text-white'
              : 'border border-[#DEE5EC] bg-white text-[#607185] hover:bg-[#EAF2F7]'
          }`}
          onClick={() => { setViewFilter('MINE'); setFilters((prev) => ({ ...prev, page: 1 })); }}
        >
          Mis tareas ({counts.mine})
        </button>
        <button
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            viewFilter === 'AT_RISK'
              ? 'bg-red-600 text-white'
              : 'border border-[#DEE5EC] bg-white text-[#607185] hover:bg-red-50'
          }`}
          onClick={() => { setViewFilter('AT_RISK'); setFilters((prev) => ({ ...prev, page: 1 })); }}
        >
          En riesgo ({counts.atRisk})
        </button>
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
            {viewFilter === 'AT_RISK'
              ? 'No hay tareas en riesgo. ¡Todo en orden!'
              : viewFilter === 'MINE'
                ? 'No tenés tareas asignadas acá.'
                : hasActiveFilters
                  ? 'No se encontraron tareas con los filtros actuales.'
                  : 'Este proyecto todavía no tiene tareas.'}
          </p>
        </div>
      )}

      {/* Tabla de tareas */}
      {tasks.isSuccess && visibleTasks.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#DEE5EC] bg-white">
          {/* Header */}
          <div className="flex items-center border-b border-[#DEE5EC] bg-[#F7F9FB] text-xs font-semibold uppercase tracking-wide text-[#607185]">
            <div className="grid min-w-0 flex-1 grid-cols-[1fr_120px_120px_110px_100px] items-center gap-2 px-5 py-3">
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
            <div
              key={task.id}
              className="flex items-center border-b border-[#DEE5EC] transition-colors last:border-b-0 hover:bg-[#EAF2F7]/40"
            >
            <button
              onClick={() => onSelectTask(task.id)}
              className="grid min-w-0 flex-1 grid-cols-[1fr_120px_120px_110px_100px] items-center gap-2 px-5 py-3.5 text-left"
            >
              {/* Tarea */}
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-medium text-[#172B42]">{task.title}</p>
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
                {isTaskExceedingProjectEnd(task.dueDate, project.data?.estimatedEndDate) && (
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
                    onClick={() => setSubtaskParent(task)}
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
          ))}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[#DEE5EC] bg-[#F7F9FB] px-5 py-2.5 text-xs text-[#607185]">
            <span>
              {tasks.data
                ? `Mostrando ${visibleTasks.length} de ${tasks.data.total} tarea${tasks.data.total !== 1 ? 's' : ''}`
                : ''}
            </span>
            <Pagination
              page={filters.page ?? 1}
              totalPages={totalPages}
              onPageChange={(p) => setFilters((prev) => ({ ...prev, page: p }))}
            />
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
    </div>
  );
}