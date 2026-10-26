// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, Project, RoleName } from '@tema/shared-types';
import { ProjectPage } from './ProjectPage';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { getProject: vi.fn(), archiveProject: vi.fn() } }));
vi.mock('../components/economy/EconomyTab', () => ({
  EconomyTab: ({ project, section, onSectionChange }: { project: Project; section?: string | null; onSectionChange?: (s: string) => void }) => (
    <div data-testid="economy-tab">
      Economía de {project.name} ({section ?? 'sin sección'})
      <button onClick={() => onSectionChange?.('costos')}>ir a costos</button>
    </div>
  ),
}));
vi.mock('../components/ProjectDetail', () => ({
  ProjectDetail: ({ project }: { project: Project }) => <div data-testid="project-detail-view">Resumen de {project.name}</div>,
}));

const LEADER_ID = 'u-leader';
const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({ id, email: `${id}@tema.test`, name: id, avatarUrl: null, roles });
const project = {
  id: 'p-1', name: 'Proyecto Económico', slug: 'proyecto-economico', startDate: '2026-10-01', estimatedEndDate: null, status: 'IN_PROGRESS',
  leaderId: LEADER_ID, leader: { id: LEADER_ID, name: 'Líder Real' }, createdBy: LEADER_ID, archivedAt: null,
} as unknown as Project;

function renderPage(path: string, me: AuthenticatedUser) {
  cleanup();
  vi.mocked(api.getProject).mockResolvedValue(project);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth', 'me'], me);
  client.setQueryData(['project', 'proyecto-economico'], project);
  client.setQueryData(['project-members', 'p-1'], []);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="projects/:projectId/*" element={<ProjectPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe('ProjectPage - pestaña Economía (visibilidad por permisos)', () => {
  it.each([
    ['ADMIN', user('a', ['ADMIN'])],
    ['PROGRAM_MANAGER', user('p', ['PROGRAM_MANAGER'])],
    ['líder real del proyecto', user(LEADER_ID, ['PROJECT_LEADER'])],
  ])('%s: ve la pestaña Economía', async (_n, me) => {
    renderPage('/projects/proyecto-economico', me);
    expect(await screen.findByRole('button', { name: 'Economía' })).toBeTruthy();
  });

  it.each([
    ['líder de OTRO proyecto', user('other-leader', ['PROJECT_LEADER'])],
    ['COLLABORATOR', user('c', ['COLLABORATOR'])],
    ['OBSERVER', user('o', ['OBSERVER'])],
    ['COLLABORATOR con leaderId histórico', user(LEADER_ID, ['COLLABORATOR'])],
  ])('%s: NO ve la pestaña Economía', async (_n, me) => {
    renderPage('/projects/proyecto-economico', me);
    await screen.findByRole('button', { name: 'Resumen' });
    expect(screen.queryByRole('button', { name: 'Economía' })).toBeNull();
  });

  it('con ?view=economia el ADMIN ve la pestaña activa y el contenido de Economía', async () => {
    renderPage('/projects/proyecto-economico?view=economia', user('a', ['ADMIN']));
    expect((await screen.findByTestId('economy-tab')).textContent).toContain('Economía de Proyecto Económico');
    expect(screen.getByRole('button', { name: 'Economía' }).className).toContain('bg-[#245B78]');
    expect(screen.queryByTestId('project-detail-view')).toBeNull();
  });

  it('la sección de la URL se pasa a la pestaña (preparado para Costos/Recursos)', async () => {
    renderPage('/projects/proyecto-economico?view=economia&section=costos', user('a', ['ADMIN']));
    expect((await screen.findByTestId('economy-tab')).textContent).toContain('(costos)');
  });

  it('elegir una sección escribe ?view=economia&section= en la URL y se la pasa a la pestaña', async () => {
    renderPage('/projects/proyecto-economico?view=economia', user('a', ['ADMIN']));
    fireEvent.click(await screen.findByRole('button', { name: 'ir a costos' }));
    expect((await screen.findByTestId('economy-tab')).textContent).toContain('(costos)');
  });

  it('un COLLABORATOR que abre ?view=economia por la URL NO ve Economía: cae en Resumen', async () => {
    renderPage('/projects/proyecto-economico?view=economia', user('c', ['COLLABORATOR']));
    expect(await screen.findByTestId('project-detail-view')).toBeTruthy();
    expect(screen.queryByTestId('economy-tab')).toBeNull();
  });
});
