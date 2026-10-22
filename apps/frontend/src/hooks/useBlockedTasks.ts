import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * RF-GA-05 - Devuelve un Set con los IDs de tareas bloqueadas por dependencias.
 * Se refresca cada vez que cambian las queries del proyecto.
 */
export function useBlockedTasks(projectId: string) {
  const { data, ...rest } = useQuery({
    queryKey: ['blocked-task-ids', projectId],
    queryFn: () => api.getBlockedTaskIds(projectId),
    enabled: !!projectId,
  });

  const blockedIds = new Set(data ?? []);
  return { blockedIds, ...rest };
}