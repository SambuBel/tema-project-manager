import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCurrentUser } from './useCurrentUser';

/**
 * La fila de project_members del usuario ACTUAL en un proyecto (o null si no es
 * miembro). Misma queryKey que ya usan ProjectMembers/TeamTab/TaskForm
 * (['project-members', projectId]): React Query comparte la cache, no duplica el
 * fetch. Esto NO es un helper de permisos — solo provee el dato que
 * lib/permissions.ts necesita para decidir visibilidad.
 */
export function useMyMembership(projectId: string | undefined) {
  const { user } = useCurrentUser();
  const { data: members, isLoading } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.getProjectMembers(projectId!),
    enabled: !!projectId,
  });

  const membership = (user && members?.find((m) => m.userId === user.id)) || null;

  return { membership, members: members ?? [], isLoading };
}
