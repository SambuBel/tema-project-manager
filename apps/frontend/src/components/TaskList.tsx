import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCurrentUser } from '../hooks/useCurrentUser';
import type { Task, TaskStatus, TaskPriority, TaskFilters } from '../types/task';
import { taskStatusLabels, taskPriorityLabels } from '../types/task';

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
  const [filters, setFilters] = useState<TaskFilters>({ projectId });
  const [searchInput, setSearchInput] = useState('');
  const [statusInput, setStatusInput] = useState<TaskStatus | ''>('');
  const [priorityInput, setPriorityInput] = useState<TaskPriority | ''>('');
  const [assignedToInput, setAssignedToInput] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('ALL');

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters({
      projectId,
      search: searchInput || undefined,
      status: statusInput || undefined,
      priority: priorityInput || undefined,
      assignedToId: assignedToInput || undefined,
    });
  };

  const clearFilters = () => {
    setFilters({ projectId });
    setSearchInput('');
    setStatusInput('');
    setPriorityInput('');
    setAssignedToInput('');
    setViewFilter('ALL');
  };

  const hasActiveFilters = !!(filters.status || filters.priority || filters.search || filters.assignedToId);

  /* "Mis tareas" y "En riesgo" se aplican sobre los datos ya cargados (client-side):
     comparten la misma consulta que "Todas", solo cambia qué se muestra de esa lista. */
  const isMine = (task: Task): boolean => !!currentUser && task.assignedToId === currentUser.id;

  const visibleTasks: Task[] = (() => {
    if (!tasks.data) return [];
    if (viewFilter === 'AT_RISK') return tasks.data.filter(isAtRisk);
    if (viewFilter === 'MINE') return tasks.data.filter(isMine);
    return tasks.data;
  })();

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
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-[#DEE5EC] bg-white p-4">
        <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-3">
          <input
            className="min-w-[200px] flex-1 rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm placeholder:text-[#607185] focus:border-[#245B78] focus:outline-none"
            placeholder="Buscar por título o descripción…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />

          <select
            className="rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none"
            value={statusInput}
            onChange={(e) => setStatusInput(e.target.value as TaskStatus | '')}
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
            value={priorityInput}
            onChange={(e) => setPriorityInput(e.target.value as TaskPriority | '')}
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
            value={assignedToInput}
            onChange={(e) => setAssignedToInput(e.target.value)}
          >
            <option value="">Responsable: Todos</option>
            {[...assignees.values()].map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b]"
          >
            Buscar
          </button>

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
          <div className="grid grid-cols-[1fr_120px_120px_110px_100px] items-center gap-2 border-b border-[#DEE5EC] bg-[#F7F9FB] px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#607185]">
            <span>Tarea</span>
            <span>Responsable</span>
            <span>Estado</span>
            <span>Prioridad</span>
            <span>Vencimiento</span>
          </div>

          {/* Rows */}
          {visibleTasks.map((task) => (
            <button
              key={task.id}
              onClick={() => onSelectTask(task.id)}
              className="grid w-full grid-cols-[1fr_120px_120px_110px_100px] items-center gap-2 border-b border-[#DEE5EC] px-5 py-3.5 text-left transition-colors last:border-b-0 hover:bg-[#EAF2F7]/40"
            >
              {/* Tarea */}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#172B42]">{task.title}</p>
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
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[task.status]}`}>
                  {taskStatusLabels[task.status]}
                </span>
              </div>

              {/* Prioridad */}
              <div>
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${priorityColors[task.priority]}`}>
                  {taskPriorityLabels[task.priority]}
                </span>
              </div>

              {/* Vencimiento */}
              <div>
                <span className={`text-xs ${isOverdue(task) ? 'font-semibold text-red-600' : 'text-[#607185]'}`}>
                  {isOverdue(task) && '⚠ '}
                  {formatDate(task.dueDate)}
                </span>
              </div>
            </button>
          ))}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[#DEE5EC] bg-[#F7F9FB] px-5 py-2.5 text-xs text-[#607185]">
            <span>
              {viewFilter === 'AT_RISK'
                ? `${visibleTasks.length} tarea${visibleTasks.length !== 1 ? 's' : ''} en riesgo`
                : viewFilter === 'MINE'
                  ? `${visibleTasks.length} tarea${visibleTasks.length !== 1 ? 's' : ''} asignada${visibleTasks.length !== 1 ? 's' : ''} a vos`
                  : `${visibleTasks.length} tarea${visibleTasks.length !== 1 ? 's' : ''}`}
            </span>
            {hasActiveFilters && (
              <span className="italic">Filtros activos</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}