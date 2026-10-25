import { useQuery } from '@tanstack/react-query';
import type { MemberResourceAllocationHistoryEntry, ProjectResourceAllocationSummary } from '@tema/shared-types';
import { api } from '../lib/api';
import { economicQueryRetry } from '../lib/economicErrors';

export const projectResourceAllocationKey = (projectId: string) => ['project-resource-allocation', projectId] as const;
export const memberAllocationHistoryKey = (projectId: string, memberId: string) => ['member-allocation-history', projectId, memberId] as const;

/**
 * Miembros activos con su asignación VIGENTE (snapshot) y los totales por moneda. Es la única fuente de lo que se pinta: nunca se
 * recompone con el catálogo de perfiles. UUID del proyecto. El error manda sobre el dato en caché.
 */
export function useProjectResourceAllocation(projectId: string) {
  return useQuery<ProjectResourceAllocationSummary>({
    queryKey: projectResourceAllocationKey(projectId),
    queryFn: () => api.getProjectResourceAllocation(projectId),
    enabled: !!projectId,
    retry: economicQueryRetry,
    staleTime: 0,
  });
}

/** Todas las revisiones de un miembro (más nueva primero), cada una con SU snapshot. */
export function useMemberAllocationHistory(projectId: string, memberId: string) {
  return useQuery<MemberResourceAllocationHistoryEntry[]>({
    queryKey: memberAllocationHistoryKey(projectId, memberId),
    queryFn: () => api.getMemberResourceAllocationHistory(projectId, memberId),
    enabled: !!projectId && !!memberId,
    retry: economicQueryRetry,
    staleTime: 0,
  });
}
