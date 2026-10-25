// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, ResourceProfile, RoleName } from '@tema/shared-types';
import { ApiRequestError } from '../lib/api';
import { ResourceProfilesPage } from './ResourceProfilesPage';

const { api } = vi.hoisted(() => ({
  api: {
    listResourceProfiles: vi.fn(), createResourceProfile: vi.fn(), updateResourceProfile: vi.fn(),
    // Nada de esto debe llamarse jamás desde la pantalla de perfiles (seguridad de datos históricos):
    getProjectBudget: vi.fn(), createProjectBudget: vi.fn(), createProjectBudgetVersion: vi.fn(), listProjectCosts: vi.fn(), createProjectCost: vi.fn(), updateProjectCost: vi.fn(),
    getProjectResourceAllocations: vi.fn(), updateProjectMember: vi.fn(),
  },
}));
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api }));

const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({ id, email: `${id}@tema.test`, name: id, avatarUrl: null, roles });
const admin = user('a', ['ADMIN']);
const pm = user('p', ['PROGRAM_MANAGER']);
const leader = user('l', ['PROJECT_LEADER']);

const profile = (n: number, extra: Partial<ResourceProfile> = {}): ResourceProfile => ({
  id: `r${n}`, name: n === 1 ? 'Senior' : `Perfil ${n}`, hourlyCost: '50.00', currency: 'USD', active: true, revision: 1,
  createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T15:00:00.000Z', ...extra,
});

function renderPage(me: AuthenticatedUser) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['auth', 'me'], me);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <ResourceProfilesPage />
    </QueryClientProvider>,
  );
  return { ...view, client, invalidate };
}
const form = () => document.querySelector('form')!;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

function expectNoProjectEconomyCalls() {
  for (const name of ['getProjectBudget', 'createProjectBudget', 'createProjectBudgetVersion', 'listProjectCosts', 'createProjectCost', 'updateProjectCost', 'getProjectResourceAllocations', 'updateProjectMember'] as const) {
    expect(api[name]).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  api.listResourceProfiles.mockResolvedValue([profile(1)]);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ResourceProfilesPage - listado', () => {
  it('cargando', () => {
    api.listResourceProfiles.mockReturnValue(new Promise(() => undefined));
    renderPage(admin);
    expect(screen.getByRole('status').textContent).toBe('Cargando perfiles…');
  });

  it('cabecera con título y descripción', async () => {
    renderPage(admin);
    await screen.findByRole('table', { name: 'Perfiles de recurso' });
    expect(screen.getByRole('heading', { level: 1, name: 'Perfiles de recurso' })).toBeTruthy();
    expect(screen.getByText(/Catálogo de perfiles utilizados para estimar el costo de los recursos asignados a proyectos\./)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/snapshot|versionad/i);
  });

  it('por defecto pide solo activos (sin includeInactive); "Mostrar inactivos" lo pide al backend, no filtra en el cliente', async () => {
    api.listResourceProfiles.mockImplementation(async (inc: boolean) => (inc ? [profile(1), profile(2, { active: false })] : [profile(1)]));
    renderPage(admin);
    await screen.findByRole('table', { name: 'Perfiles de recurso' });
    expect(api.listResourceProfiles).toHaveBeenLastCalledWith(false);
    expect((screen.getByLabelText('Mostrar inactivos') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText('Perfil 2')).toBeNull();
    fireEvent.click(screen.getByLabelText('Mostrar inactivos'));
    await screen.findAllByText('Perfil 2');
    expect(api.listResourceProfiles).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByLabelText('Mostrar inactivos'));
    await waitFor(() => expect(screen.queryByText('Perfil 2')).toBeNull());
  });

  it('desktop: columnas, tarifa "USD 50,00 / h", moneda, estado con texto, revisión y fecha', async () => {
    api.listResourceProfiles.mockResolvedValue([profile(1, { hourlyCost: '40000.50', currency: 'ARS', revision: 4 }), profile(2, { active: false })]);
    renderPage(admin);
    const table = await screen.findByRole('table', { name: 'Perfiles de recurso' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Nombre', 'Tarifa por hora', 'Moneda', 'Estado', 'Revisión', 'Actualizado', 'Acciones']);
    const rows = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(rows[0]!.slice(0, 5)).toEqual(['Senior', 'ARS 40.000,50 / h', 'ARS', '●Activo', '4']);
    expect(rows[0]![5]).toMatch(/^\d{2}\/\d{2}\/2026$/);
    expect(rows[1]!.slice(0, 5)).toEqual(['Perfil 2', 'USD 50,00 / h', 'USD', '○Inactivo', '1']);
    expect(document.body.textContent).not.toContain('$');
  });

  it('mobile: una card por perfil con nombre, tarifa, moneda y estado', async () => {
    api.listResourceProfiles.mockResolvedValue([profile(1), profile(2, { active: false })]);
    renderPage(admin);
    await screen.findByRole('table', { name: 'Perfiles de recurso' });
    const cards = within(document.querySelector('ul.sm\\:hidden') as HTMLElement).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Senior');
    expect(cards[0]!.textContent).toContain('USD 50,00 / h');
    expect(cards[0]!.textContent).toContain('Activo');
    expect(cards[1]!.textContent).toContain('Inactivo');
    expect(within(cards[0]!).getByRole('button', { name: /^Editar perfil: Senior/ })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Perfiles de recurso' }).parentElement!.className).toMatch(/hidden .*sm:block/);
  });

  it('vacío (solo activos): mensaje y botón para ADMIN', async () => {
    api.listResourceProfiles.mockResolvedValue([]);
    renderPage(admin);
    await screen.findByText('No hay perfiles de recurso activos.');
    expect(screen.getAllByRole('button', { name: 'Crear perfil' })).toHaveLength(1);
  });

  it('vacío con inactivos incluidos: otro mensaje', async () => {
    api.listResourceProfiles.mockResolvedValue([]);
    renderPage(admin);
    await screen.findByText('No hay perfiles de recurso activos.');
    fireEvent.click(screen.getByLabelText('Mostrar inactivos'));
    await screen.findByText('No hay perfiles de recurso.');
  });

  it('403: mensaje propio, sin datos viejos de la caché y sin reintentos', async () => {
    api.listResourceProfiles.mockRejectedValue(new ApiRequestError(403, 'Forbidden', []));
    const { client } = renderPage(admin);
    client.setQueryData(['resource-profiles', { includeInactive: false }], [profile(1)]);
    await screen.findByText('No tenés permisos para acceder a los perfiles de recurso.');
    expect(screen.queryByText('Senior')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(api.listResourceProfiles).toHaveBeenCalledTimes(1);
  });
});

describe('ResourceProfilesPage - permisos de escritura', () => {
  it('ADMIN: ve Crear perfil, Editar y Desactivar', async () => {
    renderPage(admin);
    await screen.findByRole('table', { name: 'Perfiles de recurso' });
    expect(screen.getByRole('button', { name: 'Crear perfil' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Editar perfil: Senior/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Desactivar perfil: Senior/ }).length).toBeGreaterThan(0);
  });

  it.each([['PROGRAM_MANAGER', pm], ['PROJECT_LEADER', leader]])('%s: ve la lista en solo lectura, sin ninguna acción', async (_n, me) => {
    api.listResourceProfiles.mockResolvedValue([profile(1), profile(2, { active: false })]);
    renderPage(me);
    await screen.findByRole('table', { name: 'Perfiles de recurso' });
    expect(screen.getAllByText('Senior').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Crear perfil|Editar|Desactivar|Reactivar/ })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).toBeNull();
  });

  it('PM sin perfiles: sin botón de crear', async () => {
    api.listResourceProfiles.mockResolvedValue([]);
    renderPage(pm);
    await screen.findByText('No hay perfiles de recurso activos.');
    expect(screen.queryByRole('button', { name: 'Crear perfil' })).toBeNull();
  });
});

describe('ResourceProfilesPage - crear', () => {
  async function openCreate() {
    renderPage(admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Crear perfil' }));
    await screen.findByRole('dialog', { name: 'Crear perfil de recurso' });
  }
  const fill = (name: string, cost: string, currency: string) => {
    fireEvent.change(field('Nombre'), { target: { value: name } });
    fireEvent.change(field('Tarifa por hora'), { target: { value: cost } });
    fireEvent.change(field('Moneda'), { target: { value: currency } });
  };

  it('la moneda es un SELECTOR con ARS y USD (no un texto libre), sin elegir ninguna por defecto', async () => {
    await openCreate();
    const select = screen.getByLabelText('Moneda') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Elegí una moneda…', 'ARS — Peso argentino', 'USD — Dólar estadounidense']);
    expect(select.value).toBe('');
    fireEvent.change(field('Nombre'), { target: { value: 'Senior' } });
    fireEvent.change(field('Tarifa por hora'), { target: { value: '50' } });
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Crear perfil' }) as HTMLButtonElement).disabled).toBe(true); // falta la moneda
  });

  it('un perfil existente en otra moneda (p. ej. EUR) se muestra tal cual al editarlo', async () => {
    api.listResourceProfiles.mockResolvedValue([profile(1, { currency: 'EUR' })]);
    renderPage(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Editar perfil: Senior/ }))[0]!);
    await screen.findByRole('dialog', { name: 'Editar perfil de recurso' });
    expect((screen.getByLabelText('Moneda') as HTMLSelectElement).value).toBe('EUR');
  });

  it('no ofrece elegir "activo" al crear; la tarifa es texto decimal', async () => {
    await openCreate();
    expect(screen.queryByLabelText('Activo')).toBeNull();
    expect(field('Tarifa por hora').type).toBe('text');
    expect(field('Tarifa por hora').getAttribute('inputmode')).toBe('decimal');
  });

  it('envía nombre recortado (sin cambiar mayúsculas), tarifa string y moneda en mayúsculas; luego refresca el catálogo', async () => {
    api.createResourceProfile.mockResolvedValue(profile(9));
    const { invalidate } = renderPage(admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Crear perfil' }));
    await screen.findByRole('dialog');
    fill('  Senior Backend ', '50', 'USD');
    fireEvent.submit(form());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.createResourceProfile).toHaveBeenCalledWith({ name: 'Senior Backend', hourlyCost: '50.00', currency: 'USD' });
    expect(invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey)).toEqual([['resource-profiles']]);
    expect(api.listResourceProfiles.mock.calls.length).toBeGreaterThanOrEqual(2); // se vuelve a pedir la lista
    expectNoProjectEconomyCalls();
  });

  it('tarifa 0 permitida', async () => {
    api.createResourceProfile.mockResolvedValue(profile(9));
    await openCreate();
    fill('Pasante', '0', 'ARS');
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Crear perfil' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.submit(form());
    await waitFor(() => expect(api.createResourceProfile).toHaveBeenCalled());
    expect(api.createResourceProfile.mock.calls[0]![0]).toMatchObject({ hourlyCost: '0.00' });
  });

  it('el mismo nombre en otra moneda NO se bloquea en el cliente (Senior/USD y Senior/ARS)', async () => {
    api.listResourceProfiles.mockResolvedValue([profile(1)]);
    api.createResourceProfile.mockResolvedValue(profile(9, { currency: 'ARS' }));
    await openCreate();
    fill('Senior', '40000', 'ARS');
    fireEvent.submit(form());
    await waitFor(() => expect(api.createResourceProfile).toHaveBeenCalledWith({ name: 'Senior', hourlyCost: '40000.00', currency: 'ARS' }));
  });

  it('RESOURCE_PROFILE_NAME_CONFLICT: mensaje claro y el formulario sigue abierto', async () => {
    api.createResourceProfile.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'RESOURCE_PROFILE_NAME_CONFLICT'));
    await openCreate();
    fill('senior', '60', 'USD');
    fireEvent.submit(form());
    expect((await screen.findByRole('alert')).textContent).toBe('Ya existe un perfil con ese nombre para esta moneda.');
    expect(form()).toBeTruthy();
    expect(api.createResourceProfile).toHaveBeenCalledTimes(1);
  });

  it('error de validación del backend: se muestra su mensaje', async () => {
    api.createResourceProfile.mockRejectedValue(new ApiRequestError(400, 'Bad Request', ['El costo por hora debe ser un monto sin signo']));
    await openCreate();
    fill('X', '60', 'USD');
    fireEvent.submit(form());
    expect((await screen.findByRole('alert')).textContent).toContain('El costo por hora debe ser un monto sin signo');
  });

  it('formulario inválido: no envía', async () => {
    await openCreate();
    fireEvent.submit(form());
    expect(api.createResourceProfile).not.toHaveBeenCalled();
    expect(screen.getByText('Para guardar:')).toBeTruthy();
  });
});

describe('ResourceProfilesPage - editar', () => {
  async function openEdit(p = profile(1, { revision: 3 })) {
    api.listResourceProfiles.mockResolvedValue([p]);
    renderPage(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Editar perfil: Senior/ }))[0]!);
    await screen.findByRole('dialog', { name: 'Editar perfil de recurso' });
  }

  it('prellena nombre, tarifa, moneda y activo', async () => {
    await openEdit();
    expect(field('Nombre').value).toBe('Senior');
    expect(field('Tarifa por hora').value).toBe('50.00');
    expect(field('Moneda').value).toBe('USD');
    expect((screen.getByLabelText('Activo') as HTMLInputElement).checked).toBe(true);
  });

  it('cambiar la tarifa 50 → 60 llama SOLO al PATCH del perfil (con expectedRevision) y a nada de proyectos', async () => {
    api.updateResourceProfile.mockResolvedValue(profile(1, { hourlyCost: '60.00', revision: 4 }));
    await openEdit();
    fireEvent.change(field('Tarifa por hora'), { target: { value: '60' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.updateResourceProfile).toHaveBeenCalledTimes(1);
    expect(api.updateResourceProfile).toHaveBeenCalledWith('r1', { expectedRevision: 3, hourlyCost: '60.00' });
    expectNoProjectEconomyCalls();
  });

  it('cambiar la moneda USD → ARS también toca solo el catálogo', async () => {
    api.updateResourceProfile.mockResolvedValue(profile(1, { currency: 'ARS', revision: 4 }));
    await openEdit();
    fireEvent.change(field('Moneda'), { target: { value: 'ARS' } });
    fireEvent.submit(form());
    await waitFor(() => expect(api.updateResourceProfile).toHaveBeenCalledWith('r1', { expectedRevision: 3, currency: 'ARS' }));
    expectNoProjectEconomyCalls();
  });

  it('nombre y activo', async () => {
    api.updateResourceProfile.mockResolvedValue(profile(1, { revision: 4 }));
    await openEdit();
    fireEvent.change(field('Nombre'), { target: { value: ' Senior Plus ' } });
    fireEvent.click(screen.getByLabelText('Activo'));
    fireEvent.submit(form());
    await waitFor(() => expect(api.updateResourceProfile).toHaveBeenCalledWith('r1', { expectedRevision: 3, name: 'Senior Plus', active: false }));
  });

  it('invalida solo ["resource-profiles"]', async () => {
    api.updateResourceProfile.mockResolvedValue(profile(1, { revision: 4 }));
    api.listResourceProfiles.mockResolvedValue([profile(1, { revision: 3 })]);
    const { invalidate } = renderPage(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Editar perfil: Senior/ }))[0]!);
    await screen.findByRole('dialog');
    fireEvent.change(field('Nombre'), { target: { value: 'Otro' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey)).toEqual([['resource-profiles']]);
  });

  it('RESOURCE_PROFILE_NO_CHANGES: aviso suave, modal abierto', async () => {
    api.updateResourceProfile.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'RESOURCE_PROFILE_NO_CHANGES'));
    await openEdit();
    fireEvent.submit(form());
    expect((await screen.findByRole('status')).textContent).toBe('No hay cambios para guardar.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(form()).toBeTruthy();
    expect(api.updateResourceProfile.mock.calls[0]![1]).toEqual({ expectedRevision: 3 });
  });

  it('RESOURCE_PROFILE_NAME_CONFLICT al renombrar', async () => {
    api.updateResourceProfile.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'RESOURCE_PROFILE_NAME_CONFLICT'));
    await openEdit();
    fireEvent.change(field('Nombre'), { target: { value: 'Existente' } });
    fireEvent.submit(form());
    expect((await screen.findByRole('alert')).textContent).toBe('Ya existe un perfil con ese nombre para esta moneda.');
  });

  it('conflicto de revisión: aviso, Recargar vuelve a pedir la lista y reconstruye el formulario con los valores NUEVOS, sin reenviar el PATCH', async () => {
    api.updateResourceProfile.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'RESOURCE_PROFILE_VERSION_CONFLICT', { currentRevision: 4 }));
    await openEdit(profile(1, { revision: 3 }));
    fireEvent.change(field('Tarifa por hora'), { target: { value: '60' } });
    fireEvent.submit(form());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Este perfil fue modificado por otro usuario mientras estabas editando.');
    expect(within(alert).getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    const listCalls = api.listResourceProfiles.mock.calls.length;

    api.listResourceProfiles.mockResolvedValue([profile(1, { name: 'Senior (otro admin)', hourlyCost: '75.00', revision: 4 })]);
    fireEvent.click(within(alert).getByRole('button', { name: 'Recargar' }));

    await screen.findByDisplayValue('Senior (otro admin)');
    expect(field('Tarifa por hora').value).toBe('75.00'); // lo tipeado antes se descartó
    expect(api.listResourceProfiles.mock.calls.length).toBe(listCalls + 1);
    expect(api.updateResourceProfile).toHaveBeenCalledTimes(1); // jamás se reenvió solo
    expect(screen.queryByRole('alert')).toBeNull();

    // el siguiente guardado usa la revisión nueva
    api.updateResourceProfile.mockResolvedValue(profile(1, { revision: 5 }));
    fireEvent.change(field('Tarifa por hora'), { target: { value: '80' } });
    fireEvent.submit(form());
    await waitFor(() => expect(api.updateResourceProfile).toHaveBeenCalledTimes(2));
    expect(api.updateResourceProfile.mock.calls[1]![1]).toEqual({ expectedRevision: 4, hourlyCost: '80.00' });
  });

  it('Recargar y el perfil ya no está en la lista: mensaje "ya no existe"', async () => {
    api.updateResourceProfile.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'RESOURCE_PROFILE_VERSION_CONFLICT'));
    await openEdit();
    fireEvent.change(field('Nombre'), { target: { value: 'X' } });
    fireEvent.submit(form());
    const alert = await screen.findByRole('alert');
    api.listResourceProfiles.mockResolvedValue([]);
    fireEvent.click(within(alert).getByRole('button', { name: 'Recargar' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some((a) => a.textContent === 'Este perfil ya no existe.')).toBe(true));
  });
});

describe('ResourceProfilesPage - activar / desactivar', () => {
  it('Desactivar pide confirmación explicando que lo histórico no cambia; Cancelar no envía nada', async () => {
    renderPage(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Desactivar perfil: Senior/ }))[0]!);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('¿Querés desactivar este perfil?');
    expect(dialog.textContent).toContain('Las asignaciones históricas existentes no se modificarán.');
    expect(dialog.textContent).toContain('El perfil dejará de estar disponible para nuevas asignaciones.');
    expect(api.updateResourceProfile).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.updateResourceProfile).not.toHaveBeenCalled();
  });

  it('confirmar envía PATCH {expectedRevision, active:false} y la lista se actualiza (desaparece de activos)', async () => {
    api.listResourceProfiles.mockResolvedValue([profile(1, { revision: 2 })]);
    api.updateResourceProfile.mockImplementation(async () => {
      api.listResourceProfiles.mockResolvedValue([]);
      return profile(1, { active: false, revision: 3 });
    });
    const { invalidate } = renderPage(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Desactivar perfil: Senior/ }))[0]!);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Desactivar' }));
    await screen.findByText('No hay perfiles de recurso activos.');
    expect(api.updateResourceProfile).toHaveBeenCalledWith('r1', { expectedRevision: 2, active: false });
    expect(invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey)).toEqual([['resource-profiles']]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expectNoProjectEconomyCalls();
  });

  it('un inactivo (con "Mostrar inactivos") se Reactiva: PATCH {expectedRevision, active:true}', async () => {
    api.listResourceProfiles.mockResolvedValue([profile(2, { active: false, revision: 5 })]);
    api.updateResourceProfile.mockResolvedValue(profile(2, { revision: 6 }));
    renderPage(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Reactivar perfil: Perfil 2/ }))[0]!);
    await waitFor(() => expect(api.updateResourceProfile).toHaveBeenCalledWith('r2', { expectedRevision: 5, active: true }));
    expect(screen.queryByRole('alertdialog')).toBeNull(); // reactivar no necesita confirmación
  });

  it('conflicto al desactivar: aviso con Recargar/Cancelar; Recargar vuelve a pedir la lista y no reenvía', async () => {
    api.updateResourceProfile.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'RESOURCE_PROFILE_VERSION_CONFLICT'));
    renderPage(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Desactivar perfil: Senior/ }))[0]!);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Desactivar' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Este perfil fue modificado por otro usuario mientras estabas editando.');
    const calls = api.listResourceProfiles.mock.calls.length;
    fireEvent.click(within(alert).getByRole('button', { name: 'Recargar' }));
    await waitFor(() => expect(api.listResourceProfiles.mock.calls.length).toBe(calls + 1));
    expect(api.updateResourceProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('otro error al desactivar: aviso en la página', async () => {
    api.updateResourceProfile.mockRejectedValue(new ApiRequestError(403, 'Forbidden', []));
    renderPage(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Desactivar perfil: Senior/ }))[0]!);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Desactivar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('No tenés permisos para acceder a los perfiles de recurso.');
  });
});
