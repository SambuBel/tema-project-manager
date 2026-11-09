// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, Project, ProjectMember, RoleName } from '@tema/shared-types';
import { ProjectPage } from './ProjectPage';

vi.mock('../lib/api', () => ({ api: { getProject: vi.fn(), archiveProject: vi.fn() } }));

/** BUG-14, caso 2: "Gestionar equipo" solo con canManageTeamUI; la pestaña Equipo sigue visible para todos. */

const PROJECT_ID = 'p-demo-1';
const LEADER_ID = 'u-leader';

const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({ id, email: `${id}@tema.test`, name: id, avatarUrl: null, roles });

const project = {
  id: PROJECT_ID,
  name: 'Proyecto Demo',
  slug: 'demo',
  description: 'Proyecto de prueba',
  startDate: '2026-10-01',
  estimatedEndDate: '2026-12-31',
  status: 'IN_PROGRESS',
  leaderId: LEADER_ID,
  leader: { id: LEADER_ID, name: 'Lucía Líder', email: 'lucia@tema.test', active: true, avatarUrl: null },
  createdBy: LEADER_ID,
  archivedAt: null,
} as unknown as Project;

const member = (userId: string, projectRole: ProjectMember['projectRole']): ProjectMember =>
  ({ id: `m-${userId}`, projectId: PROJECT_ID, userId, projectRole, joinedAt: '' }) as ProjectMember;

function renderPage(me: AuthenticatedUser, members: ProjectMember[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['auth', 'me'], me);
  client.setQueryData(['project', 'demo'], project);
  client.setQueryData(['project', PROJECT_ID], project);
  client.setQueryData(['project-members', PROJECT_ID], members);
  client.setQueryData(['project-members', 'demo'], members);
  client.setQueryData(['milestones-upcoming', PROJECT_ID], []);

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/demo']}>
        <Routes>
          <Route path="projects/:projectId/*" element={<ProjectPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const manageTeamButton = () => screen.queryByRole('button', { name: 'Gestionar equipo' });

afterEach(cleanup);

describe('ProjectPage - botón "Gestionar equipo" en el Resumen', () => {
  it.each([
    ['ADMIN', user('admin-1', ['ADMIN']), []],
    ['PROGRAM_MANAGER', user('pm-1', ['PROGRAM_MANAGER']), []],
    ['líder real del proyecto', user(LEADER_ID, ['PROJECT_LEADER']), []],
  ])('%s lo ve', async (_label, actor, members) => {
    renderPage(actor, members);
    await screen.findByText(/Lucía Líder · Líder/);
    expect(manageTeamButton()).not.toBeNull();
  });

  it.each([
    ['COLLABORATOR local (Carla)', user('carla', ['COLLABORATOR']), [member('carla', 'COLLABORATOR')]],
    ['OBSERVER local (Olga)', user('olga', ['OBSERVER']), [member('olga', 'OBSERVER')]],
    ['PROJECT_LEADER de otro proyecto', user('otro-lider', ['PROJECT_LEADER']), [member('otro-lider', 'COLLABORATOR')]],
  ])('%s NO lo ve', async (_label, actor, members) => {
    renderPage(actor, members);
    await screen.findByText(/Lucía Líder · Líder/);
    expect(manageTeamButton()).toBeNull();
  });

  it('la pestaña "Equipo" sigue visible en modo lectura para el colaborador', async () => {
    renderPage(user('carla', ['COLLABORATOR']), [member('carla', 'COLLABORATOR')]);
    await screen.findByText(/Lucía Líder · Líder/);
    expect(screen.getByRole('button', { name: 'Equipo' })).toBeTruthy();
  });
});
