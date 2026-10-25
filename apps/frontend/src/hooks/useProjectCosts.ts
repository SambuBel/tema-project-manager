import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Cost, PaginatedResponse } from '@tema/shared-types';
import { api } from '../lib/api';
import { economicQueryRetry } from '../lib/economicErrors';

export const COSTS_PAGE_SIZE = 10;

/** Prefijo común de TODAS las páginas de la lista: invalidarlo refresca la que se está viendo. */
export const projectCostsKey = (projectId: string) => ['project-costs', projectId] as const;
export const projectCostsPageKey = (projectId: string, page: number, limit: number) => ['project-costs', projectId, { page, limit }] as const;
export const projectCostKey = (projectId: string, costId: string) => ['project-cost', projectId, costId] as const;

/** Una página de costos (la paginación la hace el backend). UUID del proyecto, no slug. El error manda sobre el dato en caché. */
export function useProjectCosts(projectId: string, page: number, limit = COSTS_PAGE_SIZE) {
  return useQuery<PaginatedResponse<Cost>>({
    queryKey: projectCostsPageKey(projectId, page, limit),
    queryFn: () => api.listProjectCosts(projectId, { page, limit }),
    enabled: !!projectId,
    placeholderData: keepPreviousData,
    retry: economicQueryRetry,
    staleTime: 0,
  });
}

/** Estado ACTUAL de un costo (de ahí salen el prellenado y `expectedRevision`). Nunca se reusa una copia vieja: siempre refetch. */
export function useProjectCost(projectId: string, costId: string | null) {
  return useQuery<Cost>({
    queryKey: projectCostKey(projectId, costId ?? ''),
    queryFn: () => api.getProjectCost(projectId, costId!),
    enabled: !!projectId && !!costId,
    gcTime: 0,
    retry: economicQueryRetry,
    staleTime: 0,
  });
}
