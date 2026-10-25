import { useState, useEffect } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Project, Task, TaskPriority, TaskStatus } from '@tema/shared-types';
import { BoardColumn } from './BoardColumn';
import { taskStatusLabels } from '../../types/task';
import { handleDragEndLogic } from './dragDropLogic';
import { getMutationOptions } from './mutationLogic';
import { useBlockedTasks } from '../../hooks/useBlockedTasks';
import { applyBoardFilters } from './TaskBoardFilters';

interface TaskBoardProps {
  projectId: string;
  project: Project;
  onSelectTask: (taskId: string) => void;
  /* Filtros que llegan desde la barra de pestañas (ver TaskBoardFilters). */
  assigneeFilter?: string;
  priorityFilter?: TaskPriority | '';
}

const COLUMNS: TaskStatus[] = ['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];

export function TaskBoard({
  projectId,
  project,
  onSelectTask,
  assigneeFilter = '',
  priorityFilter = '',
}: TaskBoardProps) {
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const { data: tasks, isLoading, isError } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api.listAllTasks({ projectId }),
  });

  const { blockedIds } = useBlockedTasks(projectId);

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

  const filteredTasks = applyBoardFilters(tasks ?? [], assigneeFilter, priorityFilter);

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
              blockedIds={blockedIds}
            />
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}