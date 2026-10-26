// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, RoleName } from '@tema/shared-types';
import { Sidebar } from './Sidebar';

vi.mock('./SidebarHeader', () => ({ SidebarHeader: () => null }));
vi.mock('./WorkspaceCard', () => ({ WorkspaceCard: () => null }));
vi.mock('./SidebarUser', () => ({ SidebarUser: () => null }));

const user = (roles: RoleName[]): AuthenticatedUser => ({ id: 'u', email: 'u@tema.test', name: 'u', avatarUrl: null, roles });

function renderSidebar(me: AuthenticatedUser) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth', 'me'], me);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(cleanup);

describe('Sidebar - Perfiles de recurso', () => {
  it.each([['ADMIN', ['ADMIN']], ['PROGRAM_MANAGER', ['PROGRAM_MANAGER']], ['PROJECT_LEADER', ['PROJECT_LEADER']]] as Array<[string, RoleName[]]>)('%s ve el enlace', (_n, roles) => {
    renderSidebar(user(roles));
    const link = screen.getByRole('link', { name: 'Perfiles de recurso' });
    expect(link.getAttribute('href')).toBe('/resource-profiles');
  });

  it.each([['COLLABORATOR', ['COLLABORATOR']], ['OBSERVER', ['OBSERVER']]] as Array<[string, RoleName[]]>)('%s NO ve el enlace', (_n, roles) => {
    renderSidebar(user(roles));
    expect(screen.queryByRole('link', { name: 'Perfiles de recurso' })).toBeNull();
    expect(screen.queryByText(/Tarifas/)).toBeNull();
  });
});
