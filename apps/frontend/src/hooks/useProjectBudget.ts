import { useQuery } from '@tanstack/react-query';
import type { Budget } from '@tema/shared-types';
import { ApiRequestError, api } from '../lib/api';
import { economicQueryRetry } from '../lib/economicErrors';

export const projectBudgetKey = (projectId: string) => ['project-budget', projectId] as const;
export const projectBudgetHistoryKey = (projectId: string) => ['project-budget-history', projectId] as const;

/**
 * Presupuesto VIGENTE del proyecto. Solo lee (formularios, historial y mutaciones viven en sus componentes).
 * `data === null` significa "el proyecto todavía no tiene presupuesto": el backend responde 404 BUDGET_NOT_FOUND y acá se
 * traduce a un estado vacío válido, no a un error. CUALQUIER otro error (403, otro 404, 5xx) se propaga tal cual: el que
 * manda es el error, nunca un dato viejo en caché. Usa el UUID del proyecto (no el slug).
 */
export function useProjectBudget(projectId: string, enabled = true) {
  return useQuery<Budget | null>({
    queryKey: projectBudgetKey(projectId),
    queryFn: async () => {
      try {
        return await api.getProjectBudget(projectId);
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404 && error.code === 'BUDGET_NOT_FOUND') return null;
        throw error;
      }
    },
    enabled: enabled && !!projectId,
    retry: economicQueryRetry,
    staleTime: 0,
  });
}
