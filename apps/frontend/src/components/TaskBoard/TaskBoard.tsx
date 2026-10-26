import { useState, useEffect } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../lib/api';
import type { Project, Task, TaskStatus } from '@tema/shared-types';
import { BoardColumn } from './BoardColumn';
import { taskStatusLabels } from '../../types/task';
import { handleDragEndLogic } from './dragDropLogic';
import { getMutationOptions } from './mutationLogic';
import { CompleteTaskWithSubtasksModal } from '../CompleteTaskWithSubtasksModal';

interface TaskBoardProps {
  projectId: string;
  project: Project;
  onSelectTask: (taskId: string) => void;
}

const COLUMNS: TaskStatus[] = ['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];

export function TaskBoard({ projectId, project, onSelectTask }: TaskBoardProps) {
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [pendingSubtasksTaskId, setPendingSubtasksTaskId] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isConfirmingSubtasks, setIsConfirmingSubtasks] = useState(false);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    if (successToast) {
      const timer = setTimeout(() => setSuccessToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [successToast]);

  const { data: tasks, isLoading, isError } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api.listAllTasks({ projectId }),
  });

  const mutation = useMutation(
    getMutationOptions(qc, projectId, api.updateTaskStatus, setToast, (taskId) => {
      setModalError(null);
      setPendingSubtasksTaskId(taskId);
    }),
  );

  const handleDragEnd = (result: DropResult) => {
    handleDragEndLogic(result, {
      onValidDrop: (taskId, destStatus) => {
        if (destStatus === 'COMPLETED') {
          const targetTask = tasks?.find((t) => t.id === taskId);
          const pendingSubs = targetTask
            ? Math.max(0, (targetTask.subtaskCount ?? 0) - (targetTask.completedSubtaskCount ?? 0))
            : 0;
          if (pendingSubs > 0) {
            setModalError(null);
            setPendingSubtasksTaskId(taskId);
            return;
          }
        }
        mutation.mutate({ taskId, status: destStatus });
      },
      onInvalidTransition: (sourceStatus, destStatus) => {
        setToast(`No se puede pasar una tarea de ${taskStatusLabels[sourceStatus]} a ${taskStatusLabels[destStatus]}.`);
      },
    });
  };

  const handleConfirmCompleteSubtasks = async () => {
    if (!pendingSubtasksTaskId || isConfirmingSubtasks) return;
    setIsConfirmingSubtasks(true);
    setModalError(null);

    try {
      await api.updateTaskStatus(pendingSubtasksTaskId, 'COMPLETED', { completeSubtasks: true });
      setPendingSubtasksTaskId(null);
      setSuccessToast('Se completaron las subtareas pendientes y la tarea principal.');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks', projectId] }),
        qc.invalidateQueries({ queryKey: ['subtasks'] }),
        qc.invalidateQueries({ queryKey: ['milestones', projectId] }),
        qc.invalidateQueries({ queryKey: ['milestones-upcoming', projectId] }),
        qc.invalidateQueries({ queryKey: ['milestone-detail'] }),
        qc.invalidateQueries({ queryKey: ['gantt'] }),
      ]);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setModalError(
          err.details && err.details.length > 0
            ? err.details.join(' ')
            : err.message || 'No se pudo completar la tarea ni sus subtareas.',
        );
      } else {
        setModalError('Error al completar las subtareas y la tarea principal.');
      }
    } finally {
      setIsConfirmingSubtasks(false);
    }
  };

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

  const pendingModalTask = pendingSubtasksTaskId
    ? tasks?.find((t) => t.id === pendingSubtasksTaskId)
    : undefined;

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
      {successToast && (
        <div
          role="status"
          className="fixed top-6 left-1/2 -translate-x-1/2 z-50 rounded-lg shadow-lg bg-emerald-700 text-white px-5 py-3 text-sm font-medium flex items-center gap-3"
        >
          <span>✓ {successToast}</span>
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
            />
          ))}
        </div>
      </DragDropContext>

      <CompleteTaskWithSubtasksModal
        open={Boolean(pendingSubtasksTaskId)}
        taskTitle={pendingModalTask?.title}
        pendingSubtaskCount={
          pendingModalTask
            ? Math.max(0, (pendingModalTask.subtaskCount ?? 0) - (pendingModalTask.completedSubtaskCount ?? 0))
            : undefined
        }
        isConfirming={isConfirmingSubtasks}
        errorMessage={modalError}
        onCancel={() => {
          if (isConfirmingSubtasks) return;
          setPendingSubtasksTaskId(null);
          setModalError(null);
        }}
        onConfirm={() => void handleConfirmCompleteSubtasks()}
      />
    </div>
  );
}
