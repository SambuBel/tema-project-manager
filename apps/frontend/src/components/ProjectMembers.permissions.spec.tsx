import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, Project, ProjectMember, RoleName } from '@tema/shared-types';
import { ProjectMembers } from './ProjectMembers';

const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({ id, email: `${id}@tema.com`, name: id, avatarUrl: null, roles });

const project = { id: 'p1', name: 'Proyecto Alfa', leaderId: 'u1', leader: { id: 'u1', name: 'Líder Histórico' } } as unknown as Project;
const member = {
  id: 'm1',
  projectId: 'p1',
  userId: 'm-user',
  projectRole: 'COLLABORATOR',
  joinedAt: '2026-01-01T00:00:00Z',
  user: { id: 'm-user', name: 'Miembro Uno', email: 'm@tema.com' },
} as unknown as ProjectMember;

function render(me: AuthenticatedUser) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth', 'me'], me);
  client.setQueryData(['project-members', 'p1'], [member]);
  client.setQueryData(['project-invitations', 'p1'], []);
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectMembers project={project} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectMembers (pestaña Equipo) - gestión según líder real', () => {
  it.each([
    ['COLLABORATOR con leaderId histórico', user('u1', ['COLLABORATOR'])],
    ['OBSERVER con leaderId histórico', user('u1', ['OBSERVER'])],
    ['PROJECT_LEADER de otro proyecto', user('u2', ['PROJECT_LEADER'])],
  ])('%s: solo lectura, sin quitar ni cambiar rol ni invitar', (_label, actor) => {
    const html = render(actor);
    expect(html).toContain('Miembro Uno'); // ve el equipo
    expect(html).toContain('Vista de solo lectura.');
    expect(html).not.toContain('Quitar');
    expect(html).not.toContain('Cambiar rol');
    expect(html).not.toContain('Invitar');
    expect(html).not.toContain('Agregar');
  });

  it('líder real: puede gestionar el equipo', () => {
    const html = render(user('u1', ['PROJECT_LEADER']));
    expect(html).toContain('Colaboración con permisos claros.');
    expect(html).toContain('Quitar');
    expect(html).toContain('Cambiar rol');
  });

  it('ADMIN sin PROJECT_LEADER: puede gestionar el equipo (bypass)', () => {
    const html = render(user('boss', ['ADMIN']));
    expect(html).toContain('Quitar');
    expect(html).toContain('Cambiar líder');
  });
});
