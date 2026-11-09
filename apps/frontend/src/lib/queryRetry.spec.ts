import { describe, expect, it } from 'vitest';
import { QueryObserver, type QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api';
import { economicQueryRetry } from './economicErrors';
import { createQueryClient } from './queryClient';
import { retryUnlessClientError } from './queryRetry';

const apiError = (status: number) => new ApiRequestError(status, 'x');

describe('retryUnlessClientError (política global de reintentos, BUG-13)', () => {
  it.each([400, 401, 403, 404, 409, 422])('un %i no se reintenta nunca', (status) => {
    expect(retryUnlessClientError(0, apiError(status))).toBe(false);
    expect(retryUnlessClientError(1, apiError(status))).toBe(false);
  });

  it.each([500, 502, 503])('un %i permite UN reintento y después no', (status) => {
    expect(retryUnlessClientError(0, apiError(status))).toBe(true);
    expect(retryUnlessClientError(1, apiError(status))).toBe(false);
    expect(retryUnlessClientError(2, apiError(status))).toBe(false);
  });

  it('un fallo de red (fetch sin respuesta, no es ApiRequestError) permite UN reintento y después no', () => {
    const network = new TypeError('Failed to fetch');
    expect(retryUnlessClientError(0, network)).toBe(true);
    expect(retryUnlessClientError(1, network)).toBe(false);
  });

  it('un valor que no es un Error se trata como transitorio: un reintento', () => {
    expect(retryUnlessClientError(0, undefined)).toBe(true);
    expect(retryUnlessClientError(1, undefined)).toBe(false);
  });
});

describe('economicQueryRetry (unificada con la política global)', () => {
  it('es la misma función: las consultas económicas conservan su comportamiento', () => {
    expect(economicQueryRetry).toBe(retryUnlessClientError);
  });

  it.each([400, 403, 404, 409])('un %i no se reintenta', (status) => {
    expect(economicQueryRetry(0, apiError(status))).toBe(false);
  });

  it('un 500 se reintenta una vez', () => {
    expect(economicQueryRetry(0, apiError(500))).toBe(true);
    expect(economicQueryRetry(1, apiError(500))).toBe(false);
  });
});

describe('createQueryClient', () => {
  it('usa la política compartida como retry por defecto de todas las consultas', () => {
    expect(createQueryClient().getDefaultOptions().queries?.retry).toBe(retryUnlessClientError);
  });
});

/** Una consulta cualquiera (sin `retry` propio) contra el cliente real de la app: lo que antes dejaba "Cargando..." ~7 s ante un 4xx. */
async function runFailingQuery(client: QueryClient, status: number): Promise<number> {
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey: ['cualquier-consulta', status],
    queryFn: async () => {
      calls++;
      throw new ApiRequestError(status, 'x');
    },
  });
  await new Promise<void>((resolve) => {
    const unsubscribe = observer.subscribe((result) => {
      if (result.status === 'error') {
        unsubscribe();
        resolve();
      }
    });
  });
  return calls;
}

describe('la política global alcanza a las consultas sin retry propio (BUG-13)', () => {
  const clientWithShortDelay = () => {
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 1 } });
    return client;
  };

  it.each([403, 404])('un %i: una sola llamada, el error llega sin esperas', async (status) => {
    expect(await runFailingQuery(clientWithShortDelay(), status)).toBe(1);
  });

  it('un 500: dos llamadas (la inicial y UN reintento)', async () => {
    expect(await runFailingQuery(clientWithShortDelay(), 500)).toBe(2);
  });
});
