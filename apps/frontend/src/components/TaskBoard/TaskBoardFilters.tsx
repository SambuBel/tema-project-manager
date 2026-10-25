import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Task, TaskPriority } from '@tema/shared-types';
import { taskPriorityLabels } from '../../types/task';

const baseSelect =
  'w-full appearance-none rounded-lg border bg-white py-2 pl-4 pr-9 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none';

/** Aplica los filtros del tablero (en el cliente, sobre las tareas ya cargadas). */
export function applyBoardFilters(tasks: Task[], assignee: string, priority: TaskPriority | ''): Task[] {
  return tasks.filter((t) => {
    if (priority && t.priority !== priority) return false;
    if (assignee === 'UNASSIGNED') return !t.assignedToId;
    if (assignee && t.assignedToId !== assignee) return false;
    return true;
  });
}

function Chevron() {
  return (
    <svg
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#607185]"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

interface TaskBoardFiltersProps {
  projectId: string;
  assignee: string;
  priority: TaskPriority | '';
  onAssigneeChange: (value: string) => void;
  onPriorityChange: (value: TaskPriority | '') => void;
}

/**
 * Desplegables Responsable / Prioridad del tablero. Se muestran en la barra de pestañas
 * (a la derecha), como en el diseño. Comparten la consulta de tareas con TaskBoard.
 */
export function TaskBoardFilters({
  projectId,
  assignee,
  priority,
  onAssigneeChange,
  onPriorityChange,
}: TaskBoardFiltersProps) {
  const { data: tasks } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api.listTasks({ projectId }),
  });

  /* Responsables que aparecen en el tablero, sin repetidos y ordenados por nombre. */
  const assignees = new Map<string, string>();
  for (const t of tasks ?? []) {
    if (t.assignedTo) assignees.set(t.assignedTo.id, t.assignedTo.name);
  }
  const options = [...assignees.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const hasActiveFilters = !!assignee || !!priority;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => {
            onAssigneeChange('');
            onPriorityChange('');
          }}
          className="px-2 text-sm text-[#607185] hover:underline"
        >
          Limpiar filtros
        </button>
      )}

      <div className="relative">
        <select
          aria-label="Filtrar por responsable"
          className={baseSelect + (assignee ? ' border-[#245B78]' : ' border-[#DEE5EC]')}
          value={assignee}
          onChange={(e) => onAssigneeChange(e.target.value)}
        >
          <option value="">Responsable</option>
          <option value="UNASSIGNED">Sin asignar</option>
          {options.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <Chevron />
      </div>

      <div className="relative">
        <select
          aria-label="Filtrar por prioridad"
          className={baseSelect + (priority ? ' border-[#245B78]' : ' border-[#DEE5EC]')}
          value={priority}
          onChange={(e) => onPriorityChange(e.target.value as TaskPriority | '')}
        >
          <option value="">Prioridad</option>
          {Object.entries(taskPriorityLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <Chevron />
      </div>
    </div>
  );
}