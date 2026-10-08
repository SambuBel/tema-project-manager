import { useQueryClient } from '@tanstack/react-query';
import type { Task, TaskStatus } from '@tema/shared-types';

export function getMutationOptions(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string,
  apiUpdateTaskStatus: (taskId: string, status: TaskStatus) => Promise<Task>,
  setToast: (msg: string) => void
) {
  return {
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      apiUpdateTaskStatus(taskId, status),
    onMutate: async ({ taskId, status }: { taskId: string; status: TaskStatus }) => {
      await qc.cancelQueries({ queryKey: ['tasks', projectId] });
      const previousTasks = qc.getQueryData<Task[]>(['tasks', projectId]);

      if (previousTasks) {
        qc.setQueryData<Task[]>(['tasks', projectId], (old) =>
          old?.map((t) => (t.id === taskId ? { ...t, status } : t))
        );
      }
      return { previousTasks };
    },
    onError: (err: Error, _variables: any, context: any) => {
      if (context?.previousTasks) {
        qc.setQueryData(['tasks', projectId], context.previousTasks);
      }
      setToast('Error al mover la tarea: ' + err.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  };
}
