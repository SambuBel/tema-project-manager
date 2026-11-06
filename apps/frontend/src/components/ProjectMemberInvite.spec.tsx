// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Project, UserWithRoles } from '@tema/shared-types';
import { ProjectMemberInvite } from './ProjectMemberInvite';

const { api } = vi.hoisted(() => ({ api: { getAvailableUsers: vi.fn(), addProjectMember: vi.fn() } }));
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api }));

const project = { id: 'p1', name: 'Proyecto', leaderId: 'leader1' } as unknown as Project;
const user = (id: string, name: string, roles: UserWithRoles['roles']) =>
  ({ id, name, email: `${id}@tema.test`, active: true, roles }) as unknown as UserWithRoles;

function renderInvite(candidates: UserWithRoles[]) {
  api.getAvailableUsers.mockResolvedValue(candidates);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectMemberInvite project={project} onBack={() => {}} />
    </QueryClientProvider>,
  );
}

async function select(name: string) {
  fireEvent.focus(screen.getByLabelText('Buscar por nombre o correo'));
  fireEvent.click(await screen.findByText(name));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectMemberInvite: rol según el rol global (BUG-02)', () => {
  it('a un usuario solo Observador global le ofrece únicamente "Observador"', async () => {
    renderInvite([user('obs-1', 'Olga Observadora', ['OBSERVER'])]);
    await select('Olga Observadora');

    const combo = screen.getByRole('combobox') as HTMLSelectElement;
    expect(combo.value).toBe('OBSERVER');
    expect(Array.from(combo.options).map((o) => o.value)).toEqual(['OBSERVER']);
  });

  it('a un Colaborador global le ofrece ambos roles, Colaborador por defecto', async () => {
    renderInvite([user('c-1', 'Carla Colaboradora', ['COLLABORATOR'])]);
    await select('Carla Colaboradora');

    const combo = screen.getByRole('combobox') as HTMLSelectElement;
    expect(combo.value).toBe('COLLABORATOR');
    expect(Array.from(combo.options).map((o) => o.value)).toEqual(['COLLABORATOR', 'OBSERVER']);
  });
});
