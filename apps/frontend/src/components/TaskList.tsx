import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Task, TaskStatus, TaskPriority, TaskFilters } from '../types/task';
import { taskStatusLabels, taskPriorityLabels } from '../types/task';

/* ───────── Helpers visuales ───────── */

const statusColors: Record<TaskStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  BLOCKED: 'bg-red-50 text-red-700',
  COMPLETED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-400',
};

const priorityColors: Record<TaskPriority, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-amber-50 text-amber-700',
  HIGH: 'bg-red-50 text-red-700',
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
  if (!dateStr) return '';
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
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return false;
  return new Date(task.dueDate) < new Date();
}

/* ───────── Props ───────── */

interface TaskListProps {
  projectId: string;
  projectName: string;
  onBack: () => void;
  onSelectTask: (taskId: string) => void;
}

/* ───────── Componente ───────── */

export function TaskList({ projectId, projectName, onBack, onSelectTask }: TaskListProps) {
  const [filters, setFilters] = useState<TaskFilters>({ projectId });
  const [searchInput, setSearchInput] = useState('');
  const [statusInput, setStatusInput] = useState<TaskStatus | ''>('');
  const [priorityInput, setPriorityInput] = useState<TaskPriority | ''>('');

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
    });
  };

  const handleStatusFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setStatusInput(e.target.value as TaskStatus | '');
  };

  const handlePriorityFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPriorityInput(e.target.value as TaskPriority | '');
  };

  const clearFilters = () => {
    setFilters({ projectId });
    setSearchInput('');
    setStatusInput('');
    setPriorityInput('');
  };

  const hasActiveFilters = !!(filters.status || filters.priority || filters.search);

  return (
    <div className="flex flex-col gap-6 text-[#172B42]">
      {/* Breadcrumb */}
      <div className="flex items-center text-sm text-[#607185]">
        <button onClick={onBack} className="hover:underline">
          Mis proyectos
        </button>
        <span className="mx-2">/</span>
        <button onClick={onBack} className="hover:underline">
          {projectName}
        </button>
        <span className="mx-2">/</span>
        <span>Tareas</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold">Tareas</h1>
        <p className="mt-1 text-sm text-[#607185]">{projectName}</p>
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-[#DEE5EC] bg-white p-4">
        <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-3">
          <input
            className="min-w-[200px] flex-1 rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm placeholder:text-[#607185] focus:border-[#245B78] focus:outline-none"
            placeholder="Buscar por título o descripción..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />

          <select
            className="rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none"
            value={statusInput}
            onChange={handleStatusFilter}
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
            onChange={handlePriorityFilter}
          >
            <option value="">Prioridad: Todas</option>
            {Object.entries(taskPriorityLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
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
        <p className="text-sm text-[#607185]">Cargando tareas...</p>
      )}

      {/* Error */}
      {tasks.isError && (
        <p className="text-sm text-red-600">Error al cargar las tareas.</p>
      )}

      {/* Empty */}
      {tasks.isSuccess && tasks.data.length === 0 && (
        <div className="rounded-xl border border-[#DEE5EC] bg-white p-8 text-center">
          <p className="text-sm text-[#607185]">
            {hasActiveFilters
              ? 'No se encontraron tareas con los filtros actuales.'
              : 'Este proyecto todavía no tiene tareas.'}
          </p>
        </div>
      )}

      {/* Task cards */}
      {tasks.isSuccess && tasks.data.length > 0 && (
        <div className="flex flex-col gap-3">
          {tasks.data.map((task) => (
            <button
              key={task.id}
              onClick={() => onSelectTask(task.id)}
              className="flex items-center gap-4 rounded-xl border border-[#DEE5EC] bg-white px-5 py-4 text-left transition-colors hover:border-[#245B78]/30 hover:bg-[#EAF2F7]/30"
            >
              {/* Título y descripción */}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[#172B42]">{task.title}</p>
                {task.description && (
                  <p className="mt-0.5 truncate text-sm text-[#607185]">
                    {task.description}
                  </p>
                )}
              </div>

              {/* Badges */}
              <div className="flex shrink-0 items-center gap-2">
                {/* Status */}
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[task.status]}`}
                >
                  {taskStatusLabels[task.status]}
                </span>

                {/* Priority */}
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${priorityColors[task.priority]}`}
                >
                  {taskPriorityLabels[task.priority]}
                </span>

                {/* Due date */}
                {task.dueDate && (
                  <span
                    className={`text-xs ${isOverdue(task) ? 'font-semibold text-red-600' : 'text-[#607185]'}`}
                  >
                    {isOverdue(task) ? '⚠ ' : ''}
                    {formatDate(task.dueDate)}
                  </span>
                )}

                {/* Assignee */}
                {task.assignedTo ? (
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[#EAF2F7] text-[10px] font-semibold text-[#245B78]"
                    title={task.assignedTo.name}
                  >
                    {initials(task.assignedTo.name)}
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}