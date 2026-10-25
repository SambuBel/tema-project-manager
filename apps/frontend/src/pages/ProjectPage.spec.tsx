// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, Project, RoleName } from '@tema/shared-types';
import { ProjectPage } from './ProjectPage';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getProject: vi.fn(),
    archiveProject: vi.fn(),
  },
}));

// Mock componentes que realizan queries internas
vi.mock('../components/milestones/MilestonesManager', () => ({
  MilestonesManager: ({ project }: { project: Project }) => (
    <div data-testid="milestones-manager-view">
      Vista MilestonesManager para {project.name}
    </div>
  ),
}));

vi.mock('../components/ProjectDetail', () => ({
  ProjectDetail: ({ project, onViewMilestones }: { project: Project; onViewMilestones?: () => void }) => (
    <div data-testid="project-detail-view">
      Vista ProjectDetail para {project.name}
      <button onClick={onViewMilestones} data-testid="btn-ver-todos-hitos">
        Ver todos los hitos
      </button>
    </div>
  ),
}));

const PROJECT_ID = 'p-demo-1';
const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({
  id,
  email: `${id}@tema.test`,
  name: id,
  avatarUrl: null,
  roles,
});

const demoProject = {
  id: PROJECT_ID,
  name: 'Proyecto Demostración Hitos',
  slug: 'demo-milestones',
  description: 'Proyecto de prueba',
  startDate: '2026-10-01',
  estimatedEndDate: '2026-12-31',
  status: 'IN_PROGRESS',
  leaderId: 'u-admin',
  leader: { id: 'u-admin', name: 'Usuario Demo', email: 'demo@tema.test', active: true, avatarUrl: null },
  createdBy: 'u-admin',
  archivedAt: null,
} as unknown as Project;

function renderProjectPage(path: string, me = user('u-admin', ['ADMIN' as RoleName])) {
  cleanup();
  vi.mocked(api.getProject).mockResolvedValue(demoProject);

  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  client.setQueryData(['auth', 'me'], me);
  client.setQueryData(['me'], me);
  client.setQueryData(['project', 'demo-milestones'], demoProject);
  client.setQueryData(['project', PROJECT_ID], demoProject);
  client.setQueryData(['project-members', PROJECT_ID], []);
  client.setQueryData(['project-members', 'demo-milestones'], []);

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

describe('ProjectPage - Navegación a la pestaña Hitos (Regresión)', () => {
  it('renderiza la pestaña Hitos como activa cuando se accede con ?view=hitos', async () => {
    renderProjectPage('/projects/demo-milestones?view=hitos');

    // Debe renderizar la vista de MilestonesManager y NO la de ProjectDetail (Resumen)
    const milestonesView = await screen.findByTestId('milestones-manager-view');
    expect(milestonesView).toBeTruthy();
    expect(screen.queryByTestId('project-detail-view')).toBeNull();

    // El botón de la pestaña Hitos debe tener la clase de pestaña activa
    const tabHitos = screen.getByRole('button', { name: /^Hitos$/i });
    expect(tabHitos.className).toContain('bg-[#245B78]');
    expect(tabHitos.className).toContain('text-white');

    // La pestaña Resumen debe estar inactiva
    const tabResumen = screen.getByRole('button', { name: /^Resumen$/i });
    expect(tabResumen.className).toContain('bg-white');
  });

  it('permite cambiar de Resumen a Hitos haciendo clic en la pestaña', async () => {
    renderProjectPage('/projects/demo-milestones');

    // Inicialmente en Resumen
    expect(await screen.findByTestId('project-detail-view')).toBeTruthy();
    expect(screen.queryByTestId('milestones-manager-view')).toBeNull();

    // Clic en pestaña Hitos
    const tabHitos = screen.getByRole('button', { name: /^Hitos$/i });
    fireEvent.click(tabHitos);

    // Debe mostrar MilestonesManager y ocultar Resumen sin redirigir de vuelta
    expect(await screen.findByTestId('milestones-manager-view')).toBeTruthy();
    expect(screen.queryByTestId('project-detail-view')).toBeNull();

    // La pestaña Hitos ahora debe tener estilo activo
    expect(tabHitos.className).toContain('bg-[#245B78]');
  });

  it('permite navegar a Hitos desde el botón de la tarjeta en Resumen', async () => {
    renderProjectPage('/projects/demo-milestones');

    // Inicialmente en Resumen
    expect(await screen.findByTestId('project-detail-view')).toBeTruthy();

    // Clic en "Ver todos los hitos" dentro de Resumen
    const btnVerHitos = screen.getByTestId('btn-ver-todos-hitos');
    fireEvent.click(btnVerHitos);

    // Debe transicionar a MilestonesManager
    expect(await screen.findByTestId('milestones-manager-view')).toBeTruthy();
    expect(screen.queryByTestId('project-detail-view')).toBeNull();

    // Pestaña Hitos activa
    const tabHitos = screen.getByRole('button', { name: /^Hitos$/i });
    expect(tabHitos.className).toContain('bg-[#245B78]');
  });
});
