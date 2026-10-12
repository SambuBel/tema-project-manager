import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/** GET /projects/:projectId/gantt: read model completo (proyecto, tareas y dependencias) en una respuesta. */
export function useGantt(projectId: string) {
  return useQuery({
    queryKey: ['gantt', projectId],
    queryFn: () => api.getGantt(projectId),
    enabled: !!projectId,
  });
}
