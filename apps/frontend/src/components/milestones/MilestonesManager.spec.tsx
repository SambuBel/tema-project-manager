import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, Project, RoleName, MilestoneSummaryDto } from '@tema/shared-types';
import { MilestonesManager } from './MilestonesManager';

const makeUser = (id: string, roles: RoleName[]): AuthenticatedUser => ({
  id,
  email: `${id}@tema.com`,
  name: id,
  avatarUrl: null,
  roles,
});

const mockProject: Project = {
  id: 'proj-1',
  slug: 'proyecto-alfa',
  name: 'Proyecto Alfa',
  description: 'Descripción de prueba',
  startDate: '2026-01-01',
  estimatedEndDate: '2026-12-31',
  status: 'IN_PROGRESS',
  leaderId: 'u-leader',
  leader: { id: 'u-leader', name: 'Líder Real', email: 'leader@tema.com', avatarUrl: null, active: true },
  createdBy: 'u-leader',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
};

const sampleMilestone: MilestoneSummaryDto = {
  id: 'm-1',
  projectId: 'proj-1',
  name: 'Entrega Fase 1',
  description: 'Primera versión funcional',
  dueDate: '2026-11-15',
  completedAt: null,
  completedById: null,
  createdBy: 'u-leader',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  status: 'PENDING',
  taskCount: 4,
  completedTaskCount: 2,
  progress: 50,
};

function renderComponent(user: AuthenticatedUser, milestones: MilestoneSummaryDto[] = [sampleMilestone]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth', 'me'], user);
  client.setQueryData(['milestones', 'proj-1'], milestones);

  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MilestonesManager project={mockProject} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MilestonesManager (Pestaña Hitos)', () => {
  it('renderiza la lista de hitos con nombre, fecha objetivo, estado y progreso', () => {
    const html = renderComponent(makeUser('u-leader', ['PROJECT_LEADER']));
    expect(html).toContain('Entrega Fase 1');
    expect(html).toContain('Primera versión funcional');
    expect(html).toContain('Pendiente');
    expect(html).toContain('50%');
    expect(html).toContain('2 de 4 tareas completadas');
    expect(html).toContain('Ver detalle y tareas');
  });

  it('muestra estado vacío amigable cuando el proyecto no tiene hitos', () => {
    const html = renderComponent(makeUser('u-leader', ['PROJECT_LEADER']), []);
    expect(html).toContain('Aún no hay hitos en este proyecto');
    expect(html).toContain('Crear primer hito');
  });

  describe('Control de acceso y permisos (canManageMilestonesUI)', () => {
    it('Líder real del proyecto ve botón "+ Nuevo hito", editar y eliminar', () => {
      const html = renderComponent(makeUser('u-leader', ['PROJECT_LEADER']));
      expect(html).toContain('+</span> Nuevo hito');
      expect(html).toContain('title="Editar hito"');
      expect(html).toContain('title="Eliminar hito"');
    });

    it('ADMIN ve los botones de gestión aunque no sea líder del proyecto (bypass)', () => {
      const html = renderComponent(makeUser('u-admin', ['ADMIN']));
      expect(html).toContain('+</span> Nuevo hito');
      expect(html).toContain('title="Editar hito"');
    });

    it('PROGRAM_MANAGER ve los botones de gestión (bypass)', () => {
      const html = renderComponent(makeUser('u-pm', ['PROGRAM_MANAGER']));
      expect(html).toContain('+</span> Nuevo hito');
    });

    it('COLLABORATOR ve únicamente modo lectura (sin botón de nuevo hito ni acciones de edición)', () => {
      const html = renderComponent(makeUser('u-collab', ['COLLABORATOR']));
      expect(html).not.toContain('+</span> Nuevo hito');
      expect(html).not.toContain('title="Editar hito"');
      expect(html).not.toContain('title="Eliminar hito"');
      expect(html).not.toContain('Crear primer hito');
      // Pero sí puede ver el detalle del hito
      expect(html).toContain('Ver detalle y tareas');
    });

    it('OBSERVER ve únicamente modo lectura', () => {
      const html = renderComponent(makeUser('u-obs', ['OBSERVER']));
      expect(html).not.toContain('+</span> Nuevo hito');
      expect(html).not.toContain('title="Editar hito"');
      expect(html).toContain('Ver detalle y tareas');
    });
  });
});
