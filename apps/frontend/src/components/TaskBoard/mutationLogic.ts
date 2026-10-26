import { useQueryClient } from '@tanstack/react-query';
import type { Task, TaskStatus } from '@tema/shared-types';
import { isPendingSubtasksCompletionError } from '../CompleteTaskWithSubtasksModal';

export function getMutationOptions(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string,
  apiUpdateTaskStatus: (taskId: string, status: TaskStatus, options?: { completeSubtasks?: boolean }) => Promise<Task>,
  setToast: (msg: string) => void,
  onPendingSubtasksDetected?: (taskId: string) => void,
) {
  return {
    mutationFn: ({
      taskId,
      status,
      completeSubtasks,
    }: {
      taskId: string;
      status: TaskStatus;
      completeSubtasks?: boolean;
    }) =>
      completeSubtasks
        ? apiUpdateTaskStatus(taskId, status, { completeSubtasks: true })
        : apiUpdateTaskStatus(taskId, status),
    onMutate: async ({ taskId, status }: { taskId: string; status: TaskStatus; completeSubtasks?: boolean }) => {
      await qc.cancelQueries({ queryKey: ['tasks', projectId] });
      const previousTasks = qc.getQueryData<Task[]>(['tasks', projectId]);

      if (previousTasks) {
        qc.setQueryData<Task[]>(['tasks', projectId], (old) =>
          old?.map((t) => (t.id === taskId ? { ...t, status } : t))
        );
      }
      return { previousTasks };
    },
    onError: (err: Error, variables: { taskId: string; status: TaskStatus }, context: any) => {
      if (context?.previousTasks) {
        qc.setQueryData(['tasks', projectId], context.previousTasks);
      }
      if (
        variables?.status === 'COMPLETED' &&
        onPendingSubtasksDetected &&
        isPendingSubtasksCompletionError(err)
      ) {
        onPendingSubtasksDetected(variables.taskId);
        return;
      }
      const message =
        'details' in err && Array.isArray((err as any).details) && (err as any).details.length > 0
          ? (err as any).details[0]
          : err.message;
      setToast('Error al mover la tarea: ' + message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
      qc.invalidateQueries({ queryKey: ['subtasks'] });
      qc.invalidateQueries({ queryKey: ['milestones', projectId] });
      qc.invalidateQueries({ queryKey: ['milestones-upcoming', projectId] });
      qc.invalidateQueries({ queryKey: ['milestone-detail'] });
      qc.invalidateQueries({ queryKey: ['gantt'] });
    },
  };
}
