import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, Project, RoleName } from '@tema/shared-types';
import { EditProjectPage } from './EditProjectPage';
import { ProjectPage } from './ProjectPage';

const PROJECT_ID = 'p1';
const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({ id, email: `${id}@tema.com`, name: id, avatarUrl: null, roles });

/** leaderId = u1 (el usuario "histórico"). */
const project = {
  id: PROJECT_ID,
  name: 'Proyecto Alfa',
  description: 'desc',
  startDate: '2026-01-01',
  estimatedEndDate: '2026-12-31',
  status: 'IN_PROGRESS',
  leaderId: 'u1',
  leader: { id: 'u1', name: 'Líder Histórico' },
  createdBy: 'u1',
  archivedAt: null,
} as unknown as Project;

function render(me: AuthenticatedUser, path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth', 'me'], me);
  client.setQueryData(['me'], me);
  client.setQueryData(['project', PROJECT_ID], project);
  client.setQueryData(['project-members', PROJECT_ID], []);
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="projects/:projectId/edit" element={<EditProjectPage />} />
          <Route path="projects/:projectId/*" element={<ProjectPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const EDIT = `/projects/${PROJECT_ID}/edit`;
const DETAIL = `/projects/${PROJECT_ID}`;

describe('/projects/:id/edit (acceso por URL)', () => {
  it.each([
    ['COLLABORATOR con leaderId histórico', user('u1', ['COLLABORATOR'])],
    ['OBSERVER con leaderId histórico', user('u1', ['OBSERVER'])],
    ['COLLABORATOR cualquiera', user('c1', ['COLLABORATOR'])],
    ['OBSERVER', user('o1', ['OBSERVER'])],
    ['PROJECT_LEADER de otro proyecto', user('u2', ['PROJECT_LEADER'])],
  ])('%s: no ve el formulario, solo el aviso', (_label, actor) => {
    const html = render(actor, EDIT);
    expect(html).toContain('No tenés permiso para editar este proyecto.');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('Guardar proyecto');
  });

  it.each([
    ['líder real', user('u1', ['PROJECT_LEADER'])],
    ['ADMIN', user('boss', ['ADMIN'])],
    ['PROGRAM_MANAGER', user('boss', ['PROGRAM_MANAGER'])],
  ])('%s: ve el formulario de edición', (_label, actor) => {
    const html = render(actor, EDIT);
    expect(html).toContain('<form');
    expect(html).toContain('Guardar proyecto');
    expect(html).not.toContain('No tenés permiso');
  });
});

describe('ProjectPage (resumen): botones de edición', () => {
  it('COLLABORATOR con leaderId histórico: sin "Editar proyecto" ni "Archivar proyecto"', () => {
    const html = render(user('u1', ['COLLABORATOR']), DETAIL);
    expect(html).toContain('Proyecto Alfa');
    expect(html).not.toContain('Editar proyecto');
    expect(html).not.toContain('Archivar proyecto');
  });

  it('líder real: sí ve "Editar proyecto"', () => {
    expect(render(user('u1', ['PROJECT_LEADER']), DETAIL)).toContain('Editar proyecto');
  });

  it('la pestaña Gantt está habilitada; Tablero y Archivos siguen deshabilitadas', () => {
    const html = render(user('u1', ['PROJECT_LEADER']), DETAIL);
    const tab = (label: string) => new RegExp(`<button[^>]*>${label}</button>`).exec(html)?.[0] ?? '';
    expect(tab('Gantt')).not.toBe('');
    expect(tab('Gantt')).not.toContain('disabled');
    expect(tab('Tablero')).toContain('disabled');
    expect(tab('Archivos')).toContain('disabled');
  });
});
