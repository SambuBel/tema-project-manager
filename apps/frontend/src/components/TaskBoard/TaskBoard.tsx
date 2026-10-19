import { useState, useEffect } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Project, Task, TaskPriority, TaskStatus } from '@tema/shared-types';
import { BoardColumn } from './BoardColumn';
import { taskStatusLabels, taskPriorityLabels } from '../../types/task';
import { handleDragEndLogic } from './dragDropLogic';
import { getMutationOptions } from './mutationLogic';

interface TaskBoardProps {
  projectId: string;
  project: Project;
  onSelectTask: (taskId: string) => void;
}

const COLUMNS: TaskStatus[] = ['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];

export function TaskBoard({ projectId, project, onSelectTask }: TaskBoardProps) {
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  /* Filtros del tablero (se aplican en el cliente, sobre las tareas ya cargadas). */
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>('');

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const { data: tasks, isLoading, isError } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api.listTasks({ projectId }),
  });

  const mutation = useMutation(getMutationOptions(qc, projectId, api.updateTaskStatus, setToast));

  const handleDragEnd = (result: DropResult) => {
    handleDragEndLogic(result, {
      onValidDrop: (taskId, destStatus) => {
        mutation.mutate({ taskId, status: destStatus });
      },
      onInvalidTransition: (sourceStatus, destStatus) => {
        setToast('No se puede pasar una tarea de ' + taskStatusLabels[sourceStatus] + ' a ' + taskStatusLabels[destStatus] + '.');
      }
    });
  };

  if (isLoading) {
    return <p className="text-sm text-[#607185]">Cargando tablero...</p>;
  }

  if (isError) {
    return <p className="text-sm text-red-600">Error al cargar las tareas.</p>;
  }

  /* Responsables que aparecen en el tablero, sin repetidos y ordenados por nombre. */
  const assignees = new Map<string, string>();
  for (const t of tasks ?? []) {
    if (t.assignedTo) assignees.set(t.assignedTo.id, t.assignedTo.name);
  }
  const assigneeOptions = [...assignees.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const hasActiveFilters = !!assigneeFilter || !!priorityFilter;

  const filteredTasks = (tasks ?? []).filter((t) => {
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (assigneeFilter === 'UNASSIGNED') return !t.assignedToId;
    if (assigneeFilter && t.assignedToId !== assigneeFilter) return false;
    return true;
  });

  const clearFilters = () => {
    setAssigneeFilter('');
    setPriorityFilter('');
  };

  const tasksByStatus = COLUMNS.reduce((acc, status) => {
    acc[status] = filteredTasks.filter((t) => t.status === status);
    return acc;
  }, {} as Record<TaskStatus, Task[]>);

  return (
    <div className="relative w-full min-w-0">
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 rounded-lg shadow-lg bg-[#172B42] text-white px-5 py-3 text-sm font-medium animate-in fade-in slide-in-from-top-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          {toast}
        </div>
      )}
      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3 px-1">
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-lg px-3 py-2 text-sm text-[#607185] hover:underline"
          >
            Limpiar filtros
          </button>
        )}

        <select
          aria-label="Filtrar por responsable"
          className="rounded-lg border border-[#DEE5EC] bg-white px-3 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
        >
          <option value="">Responsable: Todos</option>
          <option value="UNASSIGNED">Sin asignar</option>
          {assigneeOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filtrar por prioridad"
          className="rounded-lg border border-[#DEE5EC] bg-white px-3 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | '')}
        >
          <option value="">Prioridad: Todas</option>
          {Object.entries(taskPriorityLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex min-h-[500px] w-full min-w-0 overflow-x-auto pb-4 px-1 overscroll-x-contain">
          {COLUMNS.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              title={taskStatusLabels[status]}
              tasks={tasksByStatus[status]}
              project={project}
              onSelectTask={onSelectTask}
            />
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}