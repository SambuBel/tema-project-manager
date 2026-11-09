import { ApiRequestError } from './api';

/**
 * Política de reintentos de las consultas (BUG-13), usada como valor por defecto del QueryClient (ver queryClient.ts):
 *  - Un error HTTP 4xx (404, 403, 400, 409...) NO se reintenta: el servidor ya contestó y volver a preguntar da lo mismo,
 *    solo dejaría la pantalla en "Cargando..." varios segundos (con los 3 reintentos de la librería, ~7 s).
 *  - Un 5xx o un fallo de red (fetch sin respuesta) puede ser transitorio: se permite UN reintento.
 * `failureCount` es la cantidad de fallos ya ocurridos (0 tras el primero). Una consulta que necesite otra cosa la
 * pisa con su propia opción `retry`.
 */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}
