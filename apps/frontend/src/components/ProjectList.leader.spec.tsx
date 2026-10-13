import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Project } from '@tema/shared-types';
import { ProjectList } from './ProjectList';

const project = (overrides: Partial<Project> & { id: string; name: string }): Project =>
  ({
    description: null,
    startDate: null,
    estimatedEndDate: null,
    status: 'IN_PROGRESS',
    leaderId: 'u-alicia',
    createdBy: 'u-alicia',
    createdAt: '',
    updatedAt: '',
    archivedAt: null,
    memberCount: 1,
    progress: 0,
    ...overrides,
  }) as Project;

const alicia = { id: 'u-alicia', name: 'Alicia Sambuceti', email: 'alicia@tema.com', avatarUrl: null, active: true };

function render(projects: Project[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['projects', {}], projects);
  return renderToString(
    <QueryClientProvider client={client}>
      <ProjectList onSelectProject={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('ProjectList - responsable de cada tarjeta', () => {
  it('con el líder resuelto (lo que ahora devuelve GET /projects) muestra su nombre y sus iniciales, no "Sin asignar"', () => {
    const html = render([project({ id: 'p3', name: 'Proyecto A - 03', leader: alicia })]);
    expect(html).toContain('Alicia Sambuceti');
    expect(html).toContain('>AS<');
    expect(html).not.toContain('Sin asignar');
  });

  it('un líder desactivado también se muestra por su nombre', () => {
    const html = render([project({ id: 'p1', name: 'P', leaderId: 'u-baja', leader: { ...alicia, id: 'u-baja', name: 'Líder Desactivado', active: false } })]);
    expect(html).toContain('Líder Desactivado');
    expect(html).not.toContain('Sin asignar');
  });

  it('solo muestra "Sin asignar" si realmente no hay líder resuelto', () => {
    const html = render([project({ id: 'p9', name: 'Huérfano', leader: undefined })]);
    expect(html).toContain('Sin asignar');
  });

  it('en una lista mixta, cada tarjeta lleva el nombre de SU líder', () => {
    const html = render([
      project({ id: 'p1', name: 'Uno', leader: alicia }),
      project({ id: 'p2', name: 'Dos', leaderId: 'u-leader', leader: { ...alicia, id: 'u-leader', name: 'Leader A Test' } }),
    ]);
    expect(html).toContain('Alicia Sambuceti');
    expect(html).toContain('Leader A Test');
    expect(html).not.toContain('Sin asignar');
  });
});
