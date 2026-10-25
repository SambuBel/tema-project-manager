// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  AuthenticatedUser, MemberResourceAllocation, MemberResourceAllocationHistoryEntry, Project, ProjectResourceAllocationSummary, ResourceProfile, RoleName,
} from '@tema/shared-types';
import { ApiRequestError } from '../../lib/api';
import { ResourcesSection } from './ResourcesSection';

const { api } = vi.hoisted(() => ({
  api: {
    getProjectResourceAllocation: vi.fn(), updateMemberResourceAllocation: vi.fn(), getMemberResourceAllocationHistory: vi.fn(), listResourceProfiles: vi.fn(),
    // No deben llamarse jamás desde Recursos:
    updateResourceProfile: vi.fn(), createResourceProfile: vi.fn(), getProjectBudget: vi.fn(), createProjectBudgetVersion: vi.fn(), createProjectCost: vi.fn(),
  },
}));
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api }));

const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({ id, email: `${id}@tema.test`, name: id, avatarUrl: null, roles });
const admin = user('u-admin', ['ADMIN']);
const pm = user('u-pm', ['PROGRAM_MANAGER']);
const leader = user('u-leader', ['PROJECT_LEADER']);
const project = { id: 'p1', slug: 'proyecto-uno', name: 'Proyecto Uno', leaderId: 'u-leader', economicCurrency: 'USD' } as unknown as Project;

const SENIOR_SNAPSHOT = { id: 'rp-senior', name: 'Senior', hourlyCost: '50.00', currency: 'USD' };
const allocation = (over: Partial<NonNullable<MemberResourceAllocation['allocation']>> = {}): NonNullable<MemberResourceAllocation['allocation']> => ({
  revision: 2, resourceProfile: SENIOR_SNAPSHOT, estimatedHours: '100.00', estimatedResourceCost: { amount: '5000.00', currency: 'USD' },
  budgetId: 'b1', budgetVersion: 2, createdAt: '2026-10-25T10:00:00.000Z', changedBy: { id: 'u9', name: 'Admin Uno' }, ...over,
});
const member = (n: number, a: MemberResourceAllocation['allocation'], name = `Miembro ${n}`): MemberResourceAllocation => ({ projectMemberId: `m${n}`, user: { id: `u${n}`, name }, allocation: a });
const summary = (members: MemberResourceAllocation[], totals: ProjectResourceAllocationSummary['totalsByCurrency'] = []): ProjectResourceAllocationSummary => ({ members, totalsByCurrency: totals });

const profile = (id: string, name: string, hourlyCost: string, currency = 'USD', extra: Partial<ResourceProfile> = {}): ResourceProfile => ({
  id, name, hourlyCost, currency, active: true, revision: 1, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', ...extra,
});
// El catálogo YA cambió: Senior vale USD 60 y existe Architect USD 80. La asignación vigente sigue con su snapshot USD 50.
const CATALOG = [profile('rp-senior', 'Senior', '60.00'), profile('rp-arch', 'Architect', '80.00')];

function renderSection(me: AuthenticatedUser) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['auth', 'me'], me);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <ResourcesSection project={project} />
    </QueryClientProvider>,
  );
  return { ...view, client, invalidate };
}
const table = () => screen.getByRole('table', { name: 'Asignación de recursos por miembro' });
const rowCells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent);
const form = () => document.querySelector('form')!;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const patchSpy = () => api.updateMemberResourceAllocation;

function neverCalled() {
  for (const name of ['updateResourceProfile', 'createResourceProfile', 'getProjectBudget', 'createProjectBudgetVersion', 'createProjectCost'] as const) expect(api[name]).not.toHaveBeenCalled();
}

beforeEach(() => {
  api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, allocation())], [{ currency: 'USD', amount: '5000.00' }]));
  api.listResourceProfiles.mockResolvedValue(CATALOG);
  api.getMemberResourceAllocationHistory.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ResourcesSection - listado', () => {
  it('cargando', () => {
    api.getProjectResourceAllocation.mockReturnValue(new Promise(() => undefined));
    renderSection(admin);
    expect(screen.getByRole('status').textContent).toBe('Cargando recursos…');
  });

  it('pide la asignación con el UUID del proyecto', async () => {
    renderSection(admin);
    await screen.findByRole('table', { name: 'Asignación de recursos por miembro' });
    expect(api.getProjectResourceAllocation).toHaveBeenCalledWith('p1');
  });

  it('sin miembros activos', async () => {
    api.getProjectResourceAllocation.mockResolvedValue(summary([]));
    renderSection(admin);
    await screen.findByText('Este proyecto no tiene miembros activos.');
  });

  it('miembro con asignación: perfil, horas, tarifa, costo, presupuesto y revisión TAL COMO los devuelve el backend (snapshot)', async () => {
    renderSection(admin);
    await screen.findByRole('table', { name: 'Asignación de recursos por miembro' });
    expect(within(table()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Miembro', 'Perfil', 'Horas estimadas', 'Tarifa utilizada', 'Costo estimado', 'Presupuesto', 'Revisión', 'Acciones']);
    const cells = rowCells(within(table()).getAllByRole('row')[1]!);
    expect(cells.slice(0, 7)).toEqual(['Miembro 1', 'Senior', '100,00 h', 'USD 50,00 / h', 'USD 5.000,00', 'Presupuesto V2', '2']);
    expect(api.listResourceProfiles).not.toHaveBeenCalled(); // el catálogo no interviene en lo que se pinta
  });

  it('miembro SIN asignación: "Sin asignación económica", Asignar (con permiso) y nada de historial', async () => {
    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, null)]));
    renderSection(admin);
    await screen.findByRole('table', { name: 'Asignación de recursos por miembro' });
    const row = within(table()).getAllByRole('row')[1]!;
    expect(within(row).getByText('Sin asignación económica')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Asignar recursos de Miembro 1' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /Historial/ })).toBeNull();
    expect(row.textContent).not.toContain('0'); // no se inventa "revisión 0"
  });

  it('faltan perfil u horas: "Sin perfil", "Sin horas" y "Sin costo estimado" (nunca USD 0)', async () => {
    api.getProjectResourceAllocation.mockResolvedValue(
      summary([
        member(1, allocation({ resourceProfile: null, estimatedResourceCost: null })),
        member(2, allocation({ estimatedHours: null, estimatedResourceCost: null })),
      ]),
    );
    renderSection(admin);
    await screen.findByRole('table', { name: 'Asignación de recursos por miembro' });
    const [, r1, r2] = within(table()).getAllByRole('row');
    expect(rowCells(r1!).slice(1, 5)).toEqual(['Sin perfil', '100,00 h', '—', 'Sin costo estimado']);
    expect(rowCells(r2!).slice(1, 5)).toEqual(['Senior', 'Sin horas', 'USD 50,00 / h', 'Sin costo estimado']);
    expect(document.body.textContent).not.toMatch(/USD 0,00/);
  });

  it('sin presupuesto vigente al asignar: lo dice, sin asociarlo al presupuesto actual', async () => {
    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, allocation({ budgetId: null, budgetVersion: null }))]));
    renderSection(admin);
    await screen.findByRole('table', { name: 'Asignación de recursos por miembro' });
    expect(within(table()).getByText('Sin presupuesto vigente al momento de la asignación')).toBeTruthy();
  });

  it('total de recursos: UNA sola línea en la moneda del proyecto, sin texto multimoneda y sin la palabra "Total"', async () => {
    api.getProjectResourceAllocation.mockResolvedValue(
      summary([member(1, allocation({ estimatedResourceCost: { amount: '10400.00', currency: 'USD' } }))], [{ currency: 'USD', amount: '10400.00' }]),
    );
    renderSection(admin);
    const heading = await screen.findByRole('heading', { name: 'Costo estimado actual de recursos' });
    const section = heading.closest('section') as HTMLElement;
    expect(within(section).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['USD 10.400,00']);
    expect(section.textContent).not.toMatch(/no se convierte|por separado|moneda\b.*separado/i); // ya no hay explicación multimoneda
    expect(document.body.textContent).not.toMatch(/\bTotal\b/i);
  });

  it('si el backend (por compatibilidad del contrato) devolviera varias líneas, se muestra lo que dice sin sumar ni convertir', async () => {
    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, allocation())], [{ currency: 'USD', amount: '10400.00' }, { currency: 'ARS', amount: '90000.00' }]));
    renderSection(admin);
    const heading = await screen.findByRole('heading', { name: 'Costo estimado actual de recursos' });
    expect(within(heading.closest('section') as HTMLElement).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['USD 10.400,00', 'ARS 90.000,00']);
    expect(document.body.textContent).not.toContain('100.400');
  });

  it('sin totales: "Sin costo estimado."', async () => {
    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, null)], []));
    renderSection(admin);
    await screen.findByText('Sin costo estimado.');
  });

  it('mobile: una card por miembro con perfil, horas, tarifa y costo, y acciones Editar / Historial', async () => {
    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, allocation()), member(2, null)]));
    renderSection(admin);
    await screen.findByRole('table', { name: 'Asignación de recursos por miembro' });
    const cards = within(document.querySelector('ul.sm\\:hidden') as HTMLElement).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Senior');
    expect(cards[0]!.textContent).toContain('100,00 h');
    expect(cards[0]!.textContent).toContain('USD 50,00 / h');
    expect(cards[0]!.textContent).toContain('USD 5.000,00');
    expect(within(cards[0]!).getByRole('button', { name: 'Editar recursos de Miembro 1' })).toBeTruthy();
    expect(within(cards[0]!).getByRole('button', { name: 'Historial de asignación de Miembro 1' })).toBeTruthy();
    expect(cards[1]!.textContent).toContain('Sin asignación económica');
    expect(table().parentElement!.className).toMatch(/hidden .*sm:block/);
  });

  it('403: mensaje de permisos, sin la tabla vieja de la caché y sin reintentos', async () => {
    api.getProjectResourceAllocation.mockRejectedValue(new ApiRequestError(403, 'Forbidden', []));
    const { client } = renderSection(admin);
    client.setQueryData(['project-resource-allocation', 'p1'], summary([member(1, allocation())]));
    await screen.findByText('No tenés permisos para acceder a la información económica de este proyecto.');
    expect(screen.queryByText('Miembro 1')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(api.getProjectResourceAllocation).toHaveBeenCalledTimes(1);
  });
});

describe('ResourcesSection - permisos y RN-25', () => {
  beforeEach(() => {
    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, allocation()), member(2, null)]));
  });

  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real', leader]])('%s: ve, edita, asigna y ve el historial', async (_n, me) => {
    renderSection(me);
    await screen.findByRole('table', { name: 'Asignación de recursos por miembro' });
    expect(screen.getAllByRole('button', { name: 'Editar recursos de Miembro 1' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Asignar recursos de Miembro 2' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Historial de asignación de Miembro 1' }).length).toBeGreaterThan(0);
  });

  it.each([['líder ajeno', user('otro', ['PROJECT_LEADER'])], ['COLLABORATOR', user('c', ['COLLABORATOR'])], ['OBSERVER', user('o', ['OBSERVER'])]])(
    '%s: aunque llegara acá no tiene acciones de escritura',
    async (_n, me) => {
      renderSection(me);
      await screen.findByRole('table', { name: 'Asignación de recursos por miembro' });
      expect(screen.queryByRole('button', { name: /^(Editar|Asignar) recursos/ })).toBeNull();
    },
  );

  it('RN-25: el componente de Equipo no muestra nada económico', () => {
    const source = readFileSync(resolve(__dirname, '../ProjectMembers.tsx'), 'utf8') + readFileSync(resolve(__dirname, '../ProjectMemberInvite.tsx'), 'utf8');
    expect(source).not.toMatch(/resource-allocation|resourceProfile|hourlyCost|estimatedHours|estimatedResourceCost|ResourcesSection/);
  });
});

describe('ResourcesSection - primera asignación (expectedRevision 0)', () => {
  async function openFirst() {
    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, null)]));
    const utils = renderSection(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Asignar recursos de Miembro 1' }))[0]!);
    await screen.findByRole('dialog', { name: 'Asignar recursos' });
    await screen.findByRole('option', { name: 'Architect — USD 80,00 / h' });
    return utils;
  }

  it('el selector ofrece el catálogo activo con "Nombre — Moneda tarifa / h" y la opción "Sin perfil"', async () => {
    await openFirst();
    expect(within(field('Perfil de recurso')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sin perfil', 'Senior — USD 60,00 / h', 'Architect — USD 80,00 / h']);
    expect(api.listResourceProfiles).toHaveBeenCalledWith(false); // solo activos
    expect(field('Horas estimadas').type).toBe('text');
    expect(field('Horas estimadas').getAttribute('inputmode')).toBe('decimal');
  });

  it('solo perfil', async () => {
    patchSpy().mockResolvedValue(member(1, allocation()));
    await openFirst();
    fireEvent.change(field('Perfil de recurso'), { target: { value: 'rp-senior' } });
    fireEvent.submit(form());
    await waitFor(() => expect(patchSpy()).toHaveBeenCalledWith('p1', 'm1', { expectedRevision: 0, resourceProfileId: 'rp-senior' }));
  });

  it('solo horas', async () => {
    patchSpy().mockResolvedValue(member(1, allocation()));
    await openFirst();
    fireEvent.change(field('Horas estimadas'), { target: { value: '100' } });
    fireEvent.submit(form());
    await waitFor(() => expect(patchSpy()).toHaveBeenCalledWith('p1', 'm1', { expectedRevision: 0, estimatedHours: '100.00' }));
  });

  it('perfil + horas: tras guardar se vuelve a pedir la asignación y se invalida solo lo de asignaciones (no el catálogo)', async () => {
    patchSpy().mockImplementation(async () => {
      api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, allocation({ revision: 1 }))], [{ currency: 'USD', amount: '5000.00' }]));
      return member(1, allocation({ revision: 1 }));
    });
    const { invalidate } = await openFirst();
    fireEvent.change(field('Perfil de recurso'), { target: { value: 'rp-senior' } });
    fireEvent.change(field('Horas estimadas'), { target: { value: '100' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patchSpy()).toHaveBeenCalledWith('p1', 'm1', { expectedRevision: 0, resourceProfileId: 'rp-senior', estimatedHours: '100.00' });
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual([['project-resource-allocation', 'p1'], ['member-allocation-history', 'p1', 'm1']]);
    expect(within(table()).getByText('USD 50,00 / h')).toBeTruthy(); // lo que pinta es la respuesta del backend
    neverCalled();
  });

  it('horas inválidas: no envía y explica', async () => {
    await openFirst();
    fireEvent.change(field('Horas estimadas'), { target: { value: '12abc' } });
    fireEvent.submit(form());
    expect(patchSpy()).not.toHaveBeenCalled();
    expect(field('Horas estimadas').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/Las horas deben ser un número sin signo/)).toBeTruthy();
  });

  it('conflicto en la primera asignación (otro guardó antes): Recargar muestra la asignación nueva y reabre como edición, sin reenviar', async () => {
    patchSpy().mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'RESOURCE_ALLOCATION_VERSION_CONFLICT', { currentRevision: 1 }));
    await openFirst();
    fireEvent.change(field('Horas estimadas'), { target: { value: '80' } });
    fireEvent.submit(form());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('La asignación de este recurso fue modificada por otro usuario mientras estabas editando.');
    expect(patchSpy().mock.calls[0]![2]).toEqual({ expectedRevision: 0, estimatedHours: '80.00' });

    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, allocation({ revision: 1, estimatedHours: '150.00' }))]));
    fireEvent.click(within(alert).getByRole('button', { name: 'Recargar' }));
    await screen.findByRole('dialog', { name: 'Editar asignación' });
    expect(field('Horas estimadas').value).toBe('150.00');
    expect((field('Perfil de recurso') as unknown as HTMLSelectElement).value).toBe('rp-senior');
    expect(patchSpy()).toHaveBeenCalledTimes(1); // jamás se reenvió solo

    patchSpy().mockResolvedValue(member(1, allocation({ revision: 2 })));
    fireEvent.change(field('Horas estimadas'), { target: { value: '160' } });
    fireEvent.submit(form());
    await waitFor(() => expect(patchSpy()).toHaveBeenCalledTimes(2));
    expect(patchSpy().mock.calls[1]![2]).toEqual({ expectedRevision: 1, estimatedHours: '160.00' });
  });
});

describe('ResourcesSection - moneda única del proyecto (filtro de perfiles)', () => {
  const MIXED_CATALOG = [
    profile('rp-sen-usd', 'Senior', '50.00', 'USD'),
    profile('rp-jun-usd', 'Junior', '20.00', 'USD'),
    profile('rp-sen-ars', 'Senior', '50000.00', 'ARS'),
    profile('rp-jun-ars', 'Junior', '20000.00', 'ARS'),
  ];

  async function openFirstIn(projectCurrency: string) {
    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, null)]));
    api.listResourceProfiles.mockResolvedValue(MIXED_CATALOG);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(['auth', 'me'], admin);
    render(
      <QueryClientProvider client={client}>
        <ResourcesSection project={{ ...project, economicCurrency: projectCurrency } as Project} />
      </QueryClientProvider>,
    );
    fireEvent.click((await screen.findAllByRole('button', { name: 'Asignar recursos de Miembro 1' }))[0]!);
    await screen.findByRole('dialog', { name: 'Asignar recursos' });
    await waitFor(() => expect(within(field('Perfil de recurso')).getAllByRole('option').length).toBeGreaterThan(1));
  }

  it('proyecto ARS: ofrece SOLO los perfiles en ARS (Senior ARS, Junior ARS) y ninguno en USD', async () => {
    await openFirstIn('ARS');
    expect(within(field('Perfil de recurso')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Sin perfil', 'Senior — ARS 50.000,00 / h', 'Junior — ARS 20.000,00 / h',
    ]);
    expect(screen.getByText(/Solo se ofrecen perfiles en ARS, la moneda del proyecto\./)).toBeTruthy();
  });

  it('proyecto USD: ofrece SOLO los perfiles en USD', async () => {
    await openFirstIn('USD');
    expect(within(field('Perfil de recurso')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Sin perfil', 'Senior — USD 50,00 / h', 'Junior — USD 20,00 / h',
    ]);
  });

  it('RESOURCE_PROFILE_CURRENCY_MISMATCH del backend: mensaje claro, formulario abierto, sin reintento', async () => {
    patchSpy().mockRejectedValue(new ApiRequestError(400, 'Bad Request', [], 'RESOURCE_PROFILE_CURRENCY_MISMATCH', { profileCurrency: 'ARS', projectCurrency: 'USD' }));
    await openFirstIn('USD');
    fireEvent.change(field('Perfil de recurso'), { target: { value: 'rp-sen-usd' } });
    fireEvent.submit(form());
    expect((await screen.findByRole('alert')).textContent).toBe('El perfil seleccionado utiliza una moneda diferente a la del proyecto.');
    expect(form()).toBeTruthy();
    expect(patchSpy()).toHaveBeenCalledTimes(1);
  });

  it('el perfil ACTUAL se conserva aunque su moneda ya no coincida con el catálogo: se muestra su snapshot', async () => {
    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, allocation())]));
    // el catálogo ya cambió ese perfil a ARS; la asignación (snapshot USD 50) no se toca y sigue mostrándose tal cual
    api.listResourceProfiles.mockResolvedValue([profile('rp-senior', 'Senior', '50000.00', 'ARS'), ...MIXED_CATALOG]);
    renderSection(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Editar recursos de Miembro 1' }))[0]!);
    await screen.findByRole('dialog', { name: 'Editar asignación' });
    await screen.findByRole('option', { name: 'Junior — USD 20,00 / h' });
    expect(screen.getByRole('option', { name: 'Senior — USD 50,00 / h (asignado)' })).toBeTruthy();
  });
});

describe('ResourcesSection - edición', () => {
  async function openEdit(a = allocation()) {
    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, a)]));
    const utils = renderSection(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Editar recursos de Miembro 1' }))[0]!);
    await screen.findByRole('dialog', { name: 'Editar asignación' });
    await screen.findByRole('option', { name: 'Architect — USD 80,00 / h' });
    return utils;
  }

  it('prellena el perfil ACTUAL con su snapshot (USD 50), no con la tarifa nueva del catálogo (USD 60), y no lo duplica', async () => {
    await openEdit();
    const options = within(field('Perfil de recurso')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Sin perfil', 'Senior — USD 50,00 / h (asignado)', 'Architect — USD 80,00 / h']);
    expect(options.join('|')).not.toContain('USD 60,00');
    expect((field('Perfil de recurso') as unknown as HTMLSelectElement).value).toBe('rp-senior');
    expect(field('Horas estimadas').value).toBe('100.00');
  });

  it('TEST CRÍTICO — tarifa histórica: cambiar solo 100 → 120 h NO manda el perfil; la UI muestra lo que devuelve el backend (USD 50 / USD 6.000), no USD 60 ni USD 7.200', async () => {
    patchSpy().mockImplementation(async () => {
      const updated = allocation({ revision: 3, estimatedHours: '120.00', estimatedResourceCost: { amount: '6000.00', currency: 'USD' } });
      api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, updated)], [{ currency: 'USD', amount: '6000.00' }]));
      return member(1, updated);
    });
    await openEdit();
    fireEvent.change(field('Horas estimadas'), { target: { value: '120' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(patchSpy()).toHaveBeenCalledTimes(1);
    const dto = patchSpy().mock.calls[0]![2];
    expect(dto).toEqual({ expectedRevision: 2, estimatedHours: '120.00' });
    expect('resourceProfileId' in dto).toBe(false); // ninguna acción de "refrescar tarifa"

    const cells = rowCells(within(table()).getAllByRole('row')[1]!);
    expect(cells.slice(1, 5)).toEqual(['Senior', '120,00 h', 'USD 50,00 / h', 'USD 6.000,00']);
    expect(document.body.textContent).not.toContain('USD 60,00');
    expect(document.body.textContent).not.toContain('USD 7.200,00');
    neverCalled();
  });

  it('elegir el MISMO perfil no es "actualizar tarifa": se envía solo la revisión y el backend responde sin cambios (aviso suave)', async () => {
    patchSpy().mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'RESOURCE_ALLOCATION_NO_CHANGES'));
    await openEdit();
    fireEvent.change(field('Perfil de recurso'), { target: { value: 'rp-senior' } });
    fireEvent.submit(form());
    expect((await screen.findByRole('status')).textContent).toBe('No hay cambios para guardar.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Editar asignación' })).toBeTruthy();
    expect(patchSpy().mock.calls[0]![2]).toEqual({ expectedRevision: 2 });
    expect(screen.queryByRole('button', { name: /tarifa vigente|actualizar a/i })).toBeNull();
  });

  it('cambio de perfil: Senior USD 50 → Architect USD 80; se muestra el snapshot NUEVO que devuelve el backend', async () => {
    patchSpy().mockImplementation(async () => {
      const updated = allocation({ revision: 3, resourceProfile: { id: 'rp-arch', name: 'Architect', hourlyCost: '80.00', currency: 'USD' }, estimatedResourceCost: { amount: '8000.00', currency: 'USD' } });
      api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, updated)]));
      return member(1, updated);
    });
    await openEdit();
    fireEvent.change(field('Perfil de recurso'), { target: { value: 'rp-arch' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patchSpy().mock.calls[0]![2]).toEqual({ expectedRevision: 2, resourceProfileId: 'rp-arch' });
    const cells = rowCells(within(table()).getAllByRole('row')[1]!);
    expect(cells.slice(1, 5)).toEqual(['Architect', '100,00 h', 'USD 80,00 / h', 'USD 8.000,00']);
    expect(document.body.textContent).not.toContain('USD 50,00 / h');
  });

  it('quitar el perfil envía resourceProfileId null (y NO toca las horas)', async () => {
    patchSpy().mockResolvedValue(member(1, allocation()));
    await openEdit();
    fireEvent.change(field('Perfil de recurso'), { target: { value: '' } });
    fireEvent.submit(form());
    await waitFor(() => expect(patchSpy()).toHaveBeenCalled());
    expect(patchSpy().mock.calls[0]![2]).toEqual({ expectedRevision: 2, resourceProfileId: null });
  });

  it('quitar las horas envía estimatedHours null; el costo vuelve null y se ve "Sin costo estimado"', async () => {
    patchSpy().mockImplementation(async () => {
      const updated = allocation({ revision: 3, estimatedHours: null, estimatedResourceCost: null });
      api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, updated)]));
      return member(1, updated);
    });
    await openEdit();
    fireEvent.change(field('Horas estimadas'), { target: { value: '' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patchSpy().mock.calls[0]![2]).toEqual({ expectedRevision: 2, estimatedHours: null });
    expect(rowCells(within(table()).getAllByRole('row')[1]!).slice(2, 5)).toEqual(['Sin horas', 'USD 50,00 / h', 'Sin costo estimado']);
  });

  it('perfil actual INACTIVO: se muestra "perfil actual inactivo", no se obliga a reemplazarlo y se pueden editar solo las horas', async () => {
    const arquitecto = { id: 'rp-inactivo', name: 'Arquitecto', hourlyCost: '80.00', currency: 'USD' };
    patchSpy().mockResolvedValue(member(1, allocation()));
    await openEdit(allocation({ resourceProfile: arquitecto, estimatedHours: '120.00', estimatedResourceCost: { amount: '9600.00', currency: 'USD' } }));
    const select = field('Perfil de recurso') as unknown as HTMLSelectElement;
    expect(select.value).toBe('rp-inactivo');
    const current = within(select).getByRole('option', { name: /Arquitecto — perfil actual inactivo/ }) as HTMLOptionElement;
    expect(current.disabled).toBe(true); // no se puede elegir como perfil nuevo
    expect(within(select).getAllByRole('option', { name: /Arquitecto/ })).toHaveLength(1);
    expect(api.listResourceProfiles).toHaveBeenCalledTimes(1);
    expect(api.listResourceProfiles).toHaveBeenCalledWith(false); // no se pide includeInactive para reconstruirlo

    fireEvent.change(field('Horas estimadas'), { target: { value: '130' } });
    fireEvent.submit(form());
    await waitFor(() => expect(patchSpy()).toHaveBeenCalled());
    expect(patchSpy().mock.calls[0]![2]).toEqual({ expectedRevision: 2, estimatedHours: '130.00' }); // sin resourceProfileId
  });

  it('mientras el catálogo carga no se marca el perfil actual como inactivo', async () => {
    api.listResourceProfiles.mockReturnValue(new Promise(() => undefined));
    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, allocation())]));
    renderSection(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Editar recursos de Miembro 1' }))[0]!);
    await screen.findByRole('dialog', { name: 'Editar asignación' });
    expect(screen.getByRole('option', { name: /Senior — USD 50,00 \/ h \(asignado\)/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /inactivo/ })).toBeNull();
  });

  it('conflicto de revisión: aviso, Recargar vuelve a pedir la asignación, reconstruye el formulario con lo NUEVO y no reenvía; luego guarda con la revisión nueva', async () => {
    patchSpy().mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'RESOURCE_ALLOCATION_VERSION_CONFLICT', { currentRevision: 3 }));
    await openEdit();
    fireEvent.change(field('Horas estimadas'), { target: { value: '120' } });
    fireEvent.submit(form());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('La asignación de este recurso fue modificada por otro usuario mientras estabas editando.');
    expect(within(alert).getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    const loads = api.getProjectResourceAllocation.mock.calls.length;

    api.getProjectResourceAllocation.mockResolvedValue(summary([member(1, allocation({ revision: 3, estimatedHours: '150.00' }))]));
    fireEvent.click(within(alert).getByRole('button', { name: 'Recargar' }));
    await waitFor(() => expect(field('Horas estimadas').value).toBe('150.00'));
    expect(api.getProjectResourceAllocation.mock.calls.length).toBe(loads + 1);
    expect(patchSpy()).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();

    patchSpy().mockResolvedValue(member(1, allocation({ revision: 4 })));
    fireEvent.change(field('Horas estimadas'), { target: { value: '155' } });
    fireEvent.submit(form());
    await waitFor(() => expect(patchSpy()).toHaveBeenCalledTimes(2));
    expect(patchSpy().mock.calls[1]![2]).toEqual({ expectedRevision: 3, estimatedHours: '155.00' });
  });

  it('RESOURCE_PROFILE_INACTIVE: mensaje, se vuelve a pedir el CATÁLOGO y no la asignación; sin reintento', async () => {
    patchSpy().mockRejectedValue(new ApiRequestError(400, 'Bad Request', [], 'RESOURCE_PROFILE_INACTIVE'));
    await openEdit();
    const allocationLoads = api.getProjectResourceAllocation.mock.calls.length;
    const catalogLoads = api.listResourceProfiles.mock.calls.length;
    fireEvent.change(field('Perfil de recurso'), { target: { value: 'rp-arch' } });
    fireEvent.submit(form());
    expect((await screen.findByRole('alert')).textContent).toBe('El perfil seleccionado ya no está activo.');
    await waitFor(() => expect(api.listResourceProfiles.mock.calls.length).toBeGreaterThan(catalogLoads));
    expect(api.getProjectResourceAllocation.mock.calls.length).toBe(allocationLoads);
    expect(patchSpy()).toHaveBeenCalledTimes(1);
  });

  it('RESOURCE_PROFILE_NOT_FOUND: "El perfil seleccionado ya no existe." y se refresca el catálogo', async () => {
    patchSpy().mockRejectedValue(new ApiRequestError(400, 'Bad Request', [], 'RESOURCE_PROFILE_NOT_FOUND'));
    await openEdit();
    const catalogLoads = api.listResourceProfiles.mock.calls.length;
    fireEvent.change(field('Perfil de recurso'), { target: { value: 'rp-arch' } });
    fireEvent.submit(form());
    expect((await screen.findByRole('alert')).textContent).toBe('El perfil seleccionado ya no existe.');
    await waitFor(() => expect(api.listResourceProfiles.mock.calls.length).toBeGreaterThan(catalogLoads));
    expect(patchSpy()).toHaveBeenCalledTimes(1);
  });

  it('PROJECT_MEMBER_NOT_FOUND: cierra el modal, avisa y vuelve a pedir la lista de asignaciones', async () => {
    patchSpy().mockRejectedValue(new ApiRequestError(404, 'Not Found', [], 'PROJECT_MEMBER_NOT_FOUND'));
    await openEdit();
    const loads = api.getProjectResourceAllocation.mock.calls.length;
    fireEvent.change(field('Horas estimadas'), { target: { value: '120' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await screen.findByRole('alert')).textContent).toContain('Este miembro ya no está disponible en el proyecto.');
    await waitFor(() => expect(api.getProjectResourceAllocation.mock.calls.length).toBeGreaterThan(loads));
  });

  it('403 al guardar: mensaje económico, formulario abierto', async () => {
    patchSpy().mockRejectedValue(new ApiRequestError(403, 'Forbidden', []));
    await openEdit();
    fireEvent.change(field('Horas estimadas'), { target: { value: '120' } });
    fireEvent.submit(form());
    expect((await screen.findByRole('alert')).textContent).toBe('No tenés permisos para acceder a la información económica de este proyecto.');
    expect(form()).toBeTruthy();
  });

  it('accesibilidad: dialog modal, foco inicial, labels, Escape cierra, y deshabilita mientras guarda', async () => {
    patchSpy().mockReturnValue(new Promise(() => undefined));
    await openEdit();
    const dialog = screen.getByRole('dialog', { name: 'Editar asignación' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    expect(field('Perfil de recurso').getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.submit(form());
    await screen.findByRole('button', { name: 'Guardando…' });
    expect(field('Horas estimadas').matches(':disabled')).toBe(true);
    fireEvent.submit(form());
    expect(patchSpy()).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('ResourcesSection - historial', () => {
  const entry = (revision: number, over: Partial<MemberResourceAllocationHistoryEntry>): MemberResourceAllocationHistoryEntry => ({
    revision, isCurrent: false, resourceProfileId: 'rp-senior', profileNameSnapshot: 'Senior', hourlyCostSnapshot: '50.00', currencySnapshot: 'USD', estimatedHours: '100.00',
    estimatedCostSnapshot: '5000.00', budgetId: 'b1', budgetVersion: 1, changedBy: { id: 'u9', name: 'Admin Uno' }, createdAt: '2026-10-20T10:00:00.000Z',
    supersededAt: '2026-10-21T10:00:00.000Z', origin: 'UI', ...over,
  });
  // V4 vigente y V3 con Arquitecto USD 80 (perfil hoy inactivo); V2 y V1 con Senior USD 50 (hoy el catálogo dice USD 100).
  const HISTORY = [
    entry(4, { isCurrent: true, supersededAt: null, resourceProfileId: 'rp-arq', profileNameSnapshot: 'Arquitecto', hourlyCostSnapshot: '80.00', estimatedHours: '130.00', estimatedCostSnapshot: '10400.00', budgetVersion: 2 }),
    entry(3, { resourceProfileId: 'rp-arq', profileNameSnapshot: 'Arquitecto', hourlyCostSnapshot: '80.00', estimatedHours: '120.00', estimatedCostSnapshot: '9600.00', budgetVersion: 2 }),
    entry(2, { estimatedHours: '120.00', estimatedCostSnapshot: '6000.00', budgetVersion: 1 }),
    entry(1, { estimatedHours: '100.00', estimatedCostSnapshot: '5000.00', budgetId: null, budgetVersion: null }),
  ];

  async function openHistory() {
    api.getMemberResourceAllocationHistory.mockResolvedValue(HISTORY);
    api.listResourceProfiles.mockResolvedValue([profile('rp-senior', 'Senior', '100.00')]); // el catálogo "cambió" otra vez
    renderSection(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Historial de asignación de Miembro 1' }))[0]!);
    return screen.findByRole('dialog', { name: 'Historial de asignación — Miembro 1' });
  }

  it('muestra V4 vigente, V3, V2 y V1 (más nueva primero), cada una con SU snapshot', async () => {
    const dialog = await openHistory();
    await within(dialog).findByText('Revisión 4');
    expect(api.getMemberResourceAllocationHistory).toHaveBeenCalledWith('p1', 'm1');
    const items = within(dialog).getAllByRole('listitem');
    expect(items.map((li) => li.textContent?.match(/Revisión (\d)/)?.[1])).toEqual(['4', '3', '2', '1']);
    expect(items[0]!.textContent).toContain('● Vigente');
    expect(items[0]!.textContent).toContain('Arquitecto');
    expect(items[0]!.textContent).toContain('USD 80,00 / h');
    expect(items[0]!.textContent).toContain('130,00 h');
    expect(items[0]!.textContent).toContain('USD 10.400,00');
    expect(items[0]!.textContent).toContain('Presupuesto V2');
    expect(items[1]!.textContent).toContain('○ Histórica');
    expect(items[1]!.textContent).toContain('USD 9.600,00');
    expect(items[2]!.textContent).toContain('Senior');
    expect(items[2]!.textContent).toContain('USD 50,00 / h');
    expect(items[2]!.textContent).toContain('USD 6.000,00');
    expect(items[3]!.textContent).toContain('USD 5.000,00');
    expect(items[3]!.textContent).toContain('Sin presupuesto vigente al momento de la asignación');
  });

  it('el catálogo (Senior USD 100, Arquitecto inactivo) NO reescribe el historial: ni se consulta ni aparece USD 100', async () => {
    const dialog = await openHistory();
    await within(dialog).findByText('Revisión 4');
    expect(api.listResourceProfiles).not.toHaveBeenCalled();
    expect(dialog.textContent).not.toContain('USD 100,00');
    expect(within(dialog).getAllByText(/USD 50,00 \/ h/)).toHaveLength(2); // V2 y V1 conservan USD 50
  });

  it('cada revisión muestra quién, cuándo y el origen (con poco protagonismo)', async () => {
    const dialog = await openHistory();
    await within(dialog).findByText('Revisión 4');
    const first = within(dialog).getAllByRole('listitem')[0]!;
    expect(first.textContent).toContain('Admin Uno');
    expect(first.textContent).toMatch(/\d{2}\/\d{2}\/2026/);
    expect(first.textContent).toContain('Origen: UI');
    expect(within(dialog).getAllByRole('listitem')[1]!.textContent).toContain('Reemplazada');
  });

  it('403 en el historial: mensaje de permisos, sin reintentos', async () => {
    api.getMemberResourceAllocationHistory.mockRejectedValue(new ApiRequestError(403, 'Forbidden', []));
    renderSection(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Historial de asignación de Miembro 1' }))[0]!);
    await screen.findByText('No tenés permisos para acceder a la información económica de este proyecto.');
    expect(api.getMemberResourceAllocationHistory).toHaveBeenCalledTimes(1);
  });

  it('se puede cerrar con Escape y con el botón', async () => {
    const dialog = await openHistory();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(dialog.isConnected).toBe(false));
  });
});
