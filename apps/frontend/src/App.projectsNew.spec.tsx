// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, RoleName } from '@tema/shared-types';
import { App } from './App';

vi.mock('./components/auth/RequireAuth', () => ({ RequireAuth: () => <Outlet /> }));
vi.mock('./components/auth/RedirectIfAuthenticated', () => ({ RedirectIfAuthenticated: () => <Outlet /> }));
vi.mock('./components/layout/AppLayout', () => ({ AppLayout: () => <Outlet /> }));
vi.mock('./pages/HomePage', () => ({ HomePage: () => <div>HOME</div> }));
vi.mock('./pages/CreateProjectPage', () => ({ CreateProjectPage: () => <div>FORMULARIO_NUEVO_PROYECTO</div> }));

const user = (roles: RoleName[]): AuthenticatedUser => ({ id: 'u', email: 'u@tema.test', name: 'u', avatarUrl: null, roles });

function renderAt(path: string, me: AuthenticatedUser) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth', 'me'], me);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(cleanup);

/** BUG-14, caso 1: misma regla que POST /projects (ADMIN, PROGRAM_MANAGER, PROJECT_LEADER). */
describe('ruta /projects/new (RequireRole + canCreateProjectUI)', () => {
  it.each([['ADMIN', ['ADMIN']], ['PROGRAM_MANAGER', ['PROGRAM_MANAGER']], ['PROJECT_LEADER', ['PROJECT_LEADER']]] as Array<[string, RoleName[]]>)(
    '%s entra al formulario',
    async (_name, roles) => {
      renderAt('/projects/new', user(roles));
      expect(await screen.findByText('FORMULARIO_NUEVO_PROYECTO')).toBeTruthy();
    },
  );

  it.each([['COLLABORATOR', ['COLLABORATOR']], ['OBSERVER', ['OBSERVER']], ['sin roles', []]] as Array<[string, RoleName[]]>)(
    '%s escribiendo la URL a mano vuelve a Inicio y no ve el formulario',
    async (_name, roles) => {
      renderAt('/projects/new', user(roles));
      expect(await screen.findByText('HOME')).toBeTruthy();
      expect(screen.queryByText('FORMULARIO_NUEVO_PROYECTO')).toBeNull();
    },
  );
});
