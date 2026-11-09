// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@tema/shared-types';
import { ApiRequestError } from '../lib/api';
import { createQueryClient } from '../lib/queryClient';
import { TaskDetail } from './TaskDetail';

/** BUG-13: tarea inexistente / sin acceso en el detalle. Cliente REAL de la app; solo la API está simulada. */

const { api } = vi.hoisted(() => {
  const known: Record<string, ReturnType<typeof vi.fn>> = { getTask: vi.fn() };
  const proxy = new Proxy(known, { get: (t, p: string) => (t[p] ??= vi.fn(() => new Promise(() => {})) as ReturnType<typeof vi.fn>) });
  return { api: proxy as typeof known & { getTask: ReturnType<typeof vi.fn> } };
});
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api }));

const me: AuthenticatedUser = { id: 'u1', email: 'u1@tema.test', name: 'U1', avatarUrl: null, roles: ['ADMIN'] };

function renderDetail() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 1 } });
  client.setQueryData(['auth', 'me'], me);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskDetail taskId="no-existe" projectId="p1" onBack={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TaskDetail con una tarea que no se puede cargar (BUG-13)', () => {
  it('404: muestra "no existe" enseguida y hace una sola llamada (sin reintentos)', async () => {
    api.getTask.mockRejectedValue(new ApiRequestError(404, 'Not Found'));
    renderDetail();

    expect(await screen.findByText('La tarea no existe o fue eliminada.', undefined, { timeout: 500 })).toBeTruthy();
    expect(api.getTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Cargando tarea/)).toBeNull();
  });

  it('403: muestra "sin acceso" enseguida y hace una sola llamada', async () => {
    api.getTask.mockRejectedValue(new ApiRequestError(403, 'Forbidden'));
    renderDetail();

    expect(await screen.findByText('No tenés acceso a esta tarea.', undefined, { timeout: 500 })).toBeTruthy();
    expect(api.getTask).toHaveBeenCalledTimes(1);
  });

  it('500: reintenta UNA vez y después muestra el error genérico', async () => {
    api.getTask.mockRejectedValue(new ApiRequestError(500, 'Server Error'));
    renderDetail();

    expect(await screen.findByText('Error al cargar la tarea.', undefined, { timeout: 2000 })).toBeTruthy();
    expect(api.getTask).toHaveBeenCalledTimes(2);
  });
});
