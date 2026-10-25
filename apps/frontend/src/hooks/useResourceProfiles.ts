import { useQuery } from '@tanstack/react-query';
import type { ResourceProfile } from '@tema/shared-types';
import { api } from '../lib/api';
import { economicQueryRetry } from '../lib/economicErrors';

/** Prefijo común de TODAS las variantes de la lista: invalidarlo refresca la que se esté viendo. */
export const resourceProfilesKey = ['resource-profiles'] as const;
export const resourceProfilesListKey = (includeInactive: boolean) => ['resource-profiles', { includeInactive }] as const;

/**
 * Catálogo global de perfiles de recurso. El filtro de inactivos lo hace el backend (`includeInactive`), no el cliente. No existe
 * endpoint de detalle: cualquier "volver a pedir un perfil" se resuelve con esta lista. El error manda sobre el dato en caché.
 */
export function useResourceProfiles(includeInactive: boolean) {
  return useQuery<ResourceProfile[]>({
    queryKey: resourceProfilesListKey(includeInactive),
    queryFn: () => api.listResourceProfiles(includeInactive),
    retry: economicQueryRetry,
    staleTime: 0,
  });
}
