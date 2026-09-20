import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/** Usuario autenticado (GET /auth/me). `user` es null si no hay sesion o mientras carga. */
export function useCurrentUser() {
  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  return { user: query.data ?? null, isLoading: query.isLoading };
}
