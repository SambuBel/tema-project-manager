// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@tema/shared-types';
import { ApiRequestError } from '../lib/api';
import { createQueryClient } from '../lib/queryClient';
import { ProjectPage } from './ProjectPage';
import { EditProjectPage } from './EditProjectPage';

/** BUG-13: proyecto inexistente / sin acceso. Cliente REAL de la app (política global de retry); la API es lo único simulado. */

const { api } = vi.hoisted(() => {
  const known: Record<string, ReturnType<typeof vi.fn>> = { getProject: vi.fn() };
  // Cualquier otra llamada que haga la pantalla queda pendiente (no interesa acá y no debe fallar ni reintentar).
  const proxy = new Proxy(known, { get: (t, p: string) => (t[p] ??= vi.fn(() => new Promise(() => {})) as ReturnType<typeof vi.fn>) });
  return { api: proxy as typeof known & { getProject: ReturnType<typeof vi.fn> } };
});
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api }));

const me: AuthenticatedUser = { id: 'u1', email: 'u1@tema.test', name: 'U1', avatarUrl: null, roles: ['ADMIN'] };

const SCREENS = [
  { name: 'ProjectPage', path: '/projects/no-existe-qa', route: 'projects/:projectId/*', element: <ProjectPage />, generic: 'Error al cargar el proyecto.' },
  { name: 'EditProjectPage', path: '/projects/no-existe-qa/edit', route: 'projects/:projectId/edit', element: <EditProjectPage />, generic: 'Error al cargar el proyecto para edición.' },
];

function renderScreen(path: string, route: string, element: JSX.Element) {
  const client = createQueryClient();
  // Se acorta la espera entre reintentos (1 s por defecto); la política sigue siendo la global.
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 1 } });
  client.setQueryData(['auth', 'me'], me);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each(SCREENS)('$name con un proyecto que no se puede cargar (BUG-13)', ({ path, route, element, generic }) => {
  it('404: muestra "no existe" enseguida y hace una sola llamada (sin reintentos)', async () => {
    api.getProject.mockRejectedValue(new ApiRequestError(404, 'Not Found'));
    renderScreen(path, route, element);

    expect(await screen.findByText('El proyecto no existe o fue eliminado.', undefined, { timeout: 500 })).toBeTruthy();
    expect(api.getProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Cargando/)).toBeNull();
  });

  it('403: muestra "sin acceso" enseguida y hace una sola llamada, sin redirigir', async () => {
    api.getProject.mockRejectedValue(new ApiRequestError(403, 'Forbidden'));
    renderScreen(path, route, element);

    expect(await screen.findByText('No tenés acceso a este proyecto.', undefined, { timeout: 500 })).toBeTruthy();
    expect(api.getProject).toHaveBeenCalledTimes(1);
  });

  it('500: reintenta UNA vez y después muestra el error genérico', async () => {
    api.getProject.mockRejectedValue(new ApiRequestError(500, 'Server Error'));
    renderScreen(path, route, element);

    expect(await screen.findByText(generic, undefined, { timeout: 2000 })).toBeTruthy();
    expect(api.getProject).toHaveBeenCalledTimes(2);
  });
});
