// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@tema/shared-types';
import { ApiRequestError } from '../lib/api';
import { EditTaskPage } from './EditTaskPage';

const { api } = vi.hoisted(() => ({ api: { getTask: vi.fn(), getMe: vi.fn() } }));
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api }));

const me: AuthenticatedUser = { id: 'u1', email: 'u1@tema.test', name: 'U1', avatarUrl: null, roles: ['PROJECT_LEADER'] };

function renderPage() {
  // Sin retry en defaultOptions: se prueba el retry propio de la página.
  const client = new QueryClient();
  client.setQueryData(['me'], me);
  client.setQueryData(['auth', 'me'], me);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tasks/no-existe/edit']}>
        <Routes>
          <Route path="tasks/:taskId/edit" element={<EditTaskPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EditTaskPage con una tarea que no se puede cargar (BUG-13)', () => {
  it.each([404, 400])('ante un %i muestra el aviso enseguida, sin reintentar', async (status) => {
    api.getTask.mockRejectedValue(new ApiRequestError(status, 'x'));
    renderPage();
    expect(await screen.findByText('La tarea no existe o fue eliminada.', undefined, { timeout: 500 })).toBeTruthy();
    expect(api.getTask).toHaveBeenCalledTimes(1);
  });

  it('ante un 403 muestra el error genérico sin reintentar', async () => {
    api.getTask.mockRejectedValue(new ApiRequestError(403, 'x'));
    renderPage();
    expect(await screen.findByText('Error al cargar la tarea para edición.', undefined, { timeout: 500 })).toBeTruthy();
    expect(api.getTask).toHaveBeenCalledTimes(1);
  });
});
