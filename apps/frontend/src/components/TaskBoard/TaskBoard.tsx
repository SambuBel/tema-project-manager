import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Task, TaskStatus } from '@tema/shared-types';
import { BoardColumn } from './BoardColumn';
import { taskStatusLabels } from '../../types/task';

interface TaskBoardProps {
  projectId: string;
  onSelectTask: (taskId: string) => void;
}

const COLUMNS: TaskStatus[] = ['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];

export function TaskBoard({ projectId, onSelectTask }: TaskBoardProps) {
  const { data: tasks, isLoading, isError } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api.listTasks({ projectId }),
  });

  if (isLoading) {
    return <p className="text-sm text-[#607185]">Cargando tablero...</p>;
  }

  if (isError) {
    return <p className="text-sm text-red-600">Error al cargar las tareas.</p>;
  }

  const tasksByStatus = COLUMNS.reduce((acc, status) => {
    acc[status] = tasks?.filter((t) => t.status === status) || [];
    return acc;
  }, {} as Record<TaskStatus, Task[]>);

  return (
    <div className="flex min-h-[500px] gap-6 overflow-x-auto pb-4">
      {COLUMNS.map((status) => (
        <BoardColumn
          key={status}
          status={status}
          title={taskStatusLabels[status]}
          tasks={tasksByStatus[status]}
          onSelectTask={onSelectTask}
        />
      ))}
    </div>
  );
}
