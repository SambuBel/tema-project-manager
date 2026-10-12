import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, RoleName, UserWithRoles } from '@tema/shared-types';
import { ProjectForm } from './ProjectForm';

const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({
  id,
  email: `${id}@tema.com`,
  name: `Nombre ${id}`,
  avatarUrl: null,
  roles,
});

const candidate = (id: string, active = true): UserWithRoles =>
  ({ id, email: `${id}@tema.com`, name: `Candidato ${id}`, avatarUrl: null, active, roles: ['PROJECT_LEADER'] }) as UserWithRoles;

/** Render del form de CREACIÓN con el cache sembrado (sin red; renderToString, sin jsdom). */
function renderCreate(me: AuthenticatedUser, candidates: UserWithRoles[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['me'], me);
  client.setQueryData(['users', { role: 'PROJECT_LEADER' }], candidates);
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectForm />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectForm (creación) - líder del proyecto', () => {
  it('PROJECT_LEADER común: sin selector; el responsable es de solo lectura (queda él mismo)', () => {
    const html = renderCreate(user('l1', ['PROJECT_LEADER']), [candidate('c1')]);
    expect(html).not.toMatch(/<select[^>]*id="responsable"/);
    expect(html).toMatch(/<input[^>]*id="responsable"[^>]*readonly/);
    expect(html).not.toContain('Candidato c1'); // no se le ofrece asignar a otro
  });

  it('ADMIN sin PROJECT_LEADER: selector obligatorio, sin nadie preseleccionado', () => {
    const html = renderCreate(user('boss', ['ADMIN']), [candidate('c1'), candidate('c2')]);
    expect(html).toMatch(/<select[^>]*id="responsable"[^>]*required/);
    expect(html).toContain('Elegí un líder');
    expect(html).toContain('Candidato c1');
    expect(html).toContain('Candidato c2');
    expect(html).toContain('Sin definir');
    expect(html).not.toMatch(/<option[^>]*selected[^>]*>Candidato/);
  });

  it('PROGRAM_MANAGER sin PROJECT_LEADER: mismo selector obligatorio', () => {
    const html = renderCreate(user('pm', ['PROGRAM_MANAGER']), [candidate('c1')]);
    expect(html).toMatch(/<select[^>]*id="responsable"[^>]*required/);
  });

  it('solo ofrece candidatos activos', () => {
    const html = renderCreate(user('boss', ['ADMIN']), [candidate('c1'), candidate('c2', false)]);
    expect(html).toContain('Candidato c1');
    expect(html).not.toContain('Candidato c2');
  });

  it('ADMIN que también es PROJECT_LEADER: arranca con él mismo seleccionado', () => {
    const me = user('boss', ['ADMIN', 'PROJECT_LEADER']);
    const html = renderCreate(me, [{ ...candidate('boss'), name: 'Nombre boss' } as UserWithRoles, candidate('c1')]);
    expect(html).toMatch(/<option[^>]*value="boss"[^>]*selected[^>]*>Nombre boss/);
    expect(html).not.toContain('Sin definir');
  });
});

describe('ProjectForm - validación de fechas de inicio y entrega', () => {
  it('deshabilita el botón de guardado y muestra error si la fecha de entrega es anterior al inicio', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['me'], user('boss', ['ADMIN', 'PROJECT_LEADER']));
    client.setQueryData(['users', { role: 'PROJECT_LEADER' }], []);
    client.setQueryData(['tasks', 'proj-1'], []);

    const projectWithInvertedDates = {
      id: 'proj-1',
      name: 'Proyecto Invertido',
      description: 'Desc',
      startDate: '2026-10-31',
      estimatedEndDate: '2026-10-01',
      status: 'PLANNED',
      leaderId: 'boss',
      leader: { id: 'boss', name: 'Nombre boss' },
    } as any;

    const html = renderToString(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProjectForm initialData={projectWithInvertedDates} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('La fecha de entrega no puede ser anterior a la de inicio.');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*\sdisabled(=|\s|>)/);
  });
});
