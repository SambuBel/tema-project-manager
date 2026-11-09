import { QueryClient } from '@tanstack/react-query';
import { retryUnlessClientError } from './queryRetry';

/** QueryClient de la app: la política de reintentos compartida como valor por defecto. Lo usan main.tsx y los tests que la ejercitan. */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: retryUnlessClientError } } });
}
