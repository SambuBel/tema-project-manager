// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, Budget, Project, RoleName } from '@tema/shared-types';
import { ApiRequestError } from '../../lib/api';
import { BudgetSection } from './BudgetSection';

const { api } = vi.hoisted(() => ({
  api: {
    getProjectBudget: vi.fn(),
    getProjectBudgetHistory: vi.fn(),
    createProjectBudget: vi.fn(),
    createProjectBudgetVersion: vi.fn(),
    listCostCategories: vi.fn(),
  },
}));
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api }));

const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({ id, email: `${id}@tema.test`, name: id, avatarUrl: null, roles });
const project = { id: 'p1', slug: 'proyecto-uno', name: 'Proyecto Uno', leaderId: 'u-leader', economicCurrency: 'ARS' } as unknown as Project;

const budget = (version: number, extra: Partial<Budget> = {}): Budget => ({
  id: `b-${version}`, projectId: 'p1', version, totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-25', isCurrent: true, supersededAt: null,
  createdBy: 'u1', createdAt: '2026-10-25T10:00:00Z',
  items: [
    { costCategoryId: 'c-rrhh', categoryName: 'Recursos humanos', amount: '600000.00' },
    { costCategoryId: 'c-soft', categoryName: 'Licencias y software', amount: '400000.00' },
  ],
  ...extra,
});

const notFound = () => new ApiRequestError(404, 'Not Found', [], 'BUDGET_NOT_FOUND');

function renderSection(me: AuthenticatedUser, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['auth', 'me'], me);
  seed?.(client);
  const view = render(
    <QueryClientProvider client={client}>
      <BudgetSection project={project} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

const admin = user('u-admin', ['ADMIN']);
const pm = user('u-pm', ['PROGRAM_MANAGER']);
const leader = user('u-leader', ['PROJECT_LEADER']);

beforeEach(() => {
  api.listCostCategories.mockResolvedValue([{ id: 'c-rrhh', name: 'Recursos humanos' }, { id: 'c-soft', name: 'Licencias y software' }]);
  api.getProjectBudgetHistory.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BudgetSection - sin presupuesto (404 BUDGET_NOT_FOUND = estado vacío, no error)', () => {
  beforeEach(() => {
    api.getProjectBudget.mockRejectedValue(notFound());
  });

  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm]])('%s: ve el aviso y el botón "Crear presupuesto"', async (_n, me) => {
    renderSection(me);
    await screen.findByText('Este proyecto todavía no tiene presupuesto.');
    expect(screen.getByRole('button', { name: 'Crear presupuesto' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull(); // no se muestra como error técnico
  });

  it('líder real: ve SOLO el aviso, sin botón de creación', async () => {
    renderSection(leader);
    await screen.findByText('Este proyecto todavía no tiene presupuesto.');
    expect(screen.queryByRole('button', { name: 'Crear presupuesto' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('no consulta el historial cuando no hay presupuesto', async () => {
    renderSection(admin);
    await screen.findByText('Este proyecto todavía no tiene presupuesto.');
    expect(api.getProjectBudgetHistory).not.toHaveBeenCalled();
  });

  it('"Crear presupuesto" abre el formulario vacío', async () => {
    renderSection(admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Crear presupuesto' }));
    await screen.findByRole('dialog', { name: 'Crear presupuesto' });
    expect((screen.getByLabelText('Total del presupuesto') as HTMLInputElement).value).toBe('');
  });

  it('crear el presupuesto: tras guardar se vuelve a pedir el vigente y se muestra', async () => {
    api.createProjectBudget.mockImplementation(async () => {
      api.getProjectBudget.mockResolvedValue(budget(1));
      return budget(1);
    });
    renderSection(admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Crear presupuesto' }));
    await screen.findAllByRole('option', { name: 'Recursos humanos' });
    fireEvent.change(screen.getByLabelText('Total del presupuesto'), { target: { value: '1000000' } });
    fireEvent.change(screen.getByLabelText('Fecha de aprobación'), { target: { value: '2026-10-25' } });
    fireEvent.change(screen.getByLabelText(/^Rubro/), { target: { value: 'c-rrhh' } });
    fireEvent.change(screen.getByLabelText(/^Importe/), { target: { value: '1000000' } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await screen.findByText('Versión 1');
    expect(api.createProjectBudget).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('BudgetSection - moneda única del proyecto', () => {
  it('el formulario de creación usa la moneda del PROYECTO (USD) y no ofrece elegir otra', async () => {
    api.getProjectBudget.mockRejectedValue(notFound());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(['auth', 'me'], admin);
    render(
      <QueryClientProvider client={client}>
        <BudgetSection project={{ ...project, economicCurrency: 'USD' } as Project} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Crear presupuesto' }));
    await screen.findByRole('dialog', { name: 'Crear presupuesto' });
    expect(screen.getByText(/Moneda del proyecto:/).textContent).toContain('USD');
    expect(screen.queryByLabelText('Moneda')).toBeNull();
  });
});

describe('BudgetSection - presupuesto vigente', () => {
  beforeEach(() => {
    api.getProjectBudget.mockResolvedValue(budget(3));
  });

  it('muestra versión, total con moneda, fecha de aprobación y las partidas con su importe', async () => {
    renderSection(admin);
    await screen.findByText('Presupuesto vigente');
    expect(screen.getByText('Versión 3')).toBeTruthy();
    expect(screen.getByText('ARS 1.000.000,00')).toBeTruthy();
    expect(screen.getByText(/Fecha de aprobación: 25\/10\/2026/)).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Partidas del presupuesto vigente' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(['Recursos humanosARS 600.000,00', 'Licencias y softwareARS 400.000,00']);
  });

  it('NO muestra indicadores pendientes de definición (disponible, comprometido, incurrido, ejecución)', async () => {
    renderSection(admin);
    await screen.findByText('Presupuesto vigente');
    expect(document.body.textContent).not.toMatch(/disponible|comprometido|incurrido|ejecuci[oó]n|alerta/i);
  });

  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm]])('%s: ve "Nueva versión" y "Ver historial"', async (_n, me) => {
    renderSection(me);
    await screen.findByText('Presupuesto vigente');
    expect(screen.getByRole('button', { name: 'Nueva versión' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver historial' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Crear presupuesto' })).toBeNull();
  });

  it('líder real: ve el presupuesto y el historial pero NO "Nueva versión" ni "Crear presupuesto"', async () => {
    renderSection(leader);
    await screen.findByText('Presupuesto vigente');
    expect(screen.getByRole('button', { name: 'Ver historial' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nueva versión' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Crear presupuesto' })).toBeNull();
  });

  it('"Ver historial" pide el historial recién al abrirlo, y "Ocultar historial" lo cierra', async () => {
    renderSection(admin);
    await screen.findByText('Presupuesto vigente');
    expect(api.getProjectBudgetHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ver historial' }));
    await screen.findByText('Historial de versiones');
    expect(api.getProjectBudgetHistory).toHaveBeenCalledWith('p1');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar historial' }));
    expect(screen.queryByText('Historial de versiones')).toBeNull();
  });

  it('usa el UUID del proyecto (no el slug) en los endpoints de presupuesto', async () => {
    renderSection(admin);
    await screen.findByText('Presupuesto vigente');
    expect(api.getProjectBudget).toHaveBeenCalledWith('p1');
    expect(api.getProjectBudget).not.toHaveBeenCalledWith('proyecto-uno');
  });
});

describe('BudgetSection - errores de la consulta (el error manda)', () => {
  it('403: muestra el mensaje de permisos y NO el dato viejo que había en caché', async () => {
    api.getProjectBudget.mockRejectedValue(new ApiRequestError(403, 'Forbidden', []));
    renderSection(admin, (client) => client.setQueryData(['project-budget', 'p1'], budget(3)));
    await screen.findByText('No tenés permisos para acceder a la información económica de este proyecto.');
    expect(screen.queryByText('Versión 3')).toBeNull();
    expect(screen.queryByText('ARS 1.000.000,00')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nueva versión' })).toBeNull();
    expect(api.getProjectBudget).toHaveBeenCalledTimes(1); // 403: no se reintenta
  });

  it('otro 404 (sin el código BUDGET_NOT_FOUND) NO se confunde con "sin presupuesto"', async () => {
    api.getProjectBudget.mockRejectedValue(new ApiRequestError(404, 'Not Found', ['Project x no encontrado']));
    renderSection(admin);
    await screen.findByRole('alert');
    expect(screen.queryByText('Este proyecto todavía no tiene presupuesto.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Crear presupuesto' })).toBeNull();
  });

  it('presupuesto inconsistente (500 con código): mensaje claro, sin detalle técnico', async () => {
    api.getProjectBudget.mockRejectedValue(new ApiRequestError(500, 'Internal Server Error', [], 'BUDGET_NO_CURRENT_VERSION'));
    renderSection(admin);
    // un 5xx se reintenta una vez (con espera) antes de mostrarse
    const alert = await screen.findByRole('alert', undefined, { timeout: 4000 });
    expect(alert.textContent).toContain('estado inconsistente');
    expect(alert.textContent).not.toContain('BUDGET_NO_CURRENT_VERSION');
  });

  it('cargando: muestra el estado de carga', () => {
    api.getProjectBudget.mockReturnValue(new Promise(() => undefined));
    renderSection(admin);
    expect(screen.getByRole('status').textContent).toBe('Cargando presupuesto…');
  });
});

describe('BudgetSection - nueva versión y conflictos', () => {
  async function openVersionForm() {
    renderSection(admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva versión' }));
    await screen.findByRole('dialog', { name: /parte de la versión 3/ });
    await screen.findAllByRole('option', { name: 'Recursos humanos' });
  }

  beforeEach(() => {
    api.getProjectBudget.mockResolvedValue(budget(3));
  });

  it('se prellena con el vigente y guarda con expectedVersion; luego se actualiza la vista', async () => {
    api.createProjectBudgetVersion.mockImplementation(async () => {
      api.getProjectBudget.mockResolvedValue(budget(4, { items: [{ costCategoryId: 'c-rrhh', categoryName: 'Recursos humanos', amount: '700000.00' }, { costCategoryId: 'c-soft', categoryName: 'Licencias y software', amount: '300000.00' }] }));
      return budget(4);
    });
    await openVersionForm();
    fireEvent.change(screen.getAllByLabelText(/^Importe/)[0]!, { target: { value: '700000' } });
    fireEvent.change(screen.getAllByLabelText(/^Importe/)[1]!, { target: { value: '300000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva versión' }));
    await screen.findByText('Versión 4');
    expect(api.createProjectBudgetVersion).toHaveBeenCalledWith('p1', expect.objectContaining({ expectedVersion: 3 }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('BUDGET_VERSION_CONFLICT: aviso, sin reintento automático; Recargar vuelve a pedir el vigente y reabre el formulario con la versión NUEVA', async () => {
    api.createProjectBudgetVersion.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'BUDGET_VERSION_CONFLICT', { currentVersion: 4 }));
    await openVersionForm();
    fireEvent.change(screen.getAllByLabelText(/^Importe/)[0]!, { target: { value: '700000' } });
    fireEvent.change(screen.getAllByLabelText(/^Importe/)[1]!, { target: { value: '300000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva versión' }));
    await screen.findByText('El presupuesto fue modificado por otro usuario mientras estabas editando.');

    // otro usuario ya creó la versión 4 (con otros importes)
    api.getProjectBudget.mockResolvedValue(
      budget(4, { totalAmount: '2000000.00', items: [{ costCategoryId: 'c-rrhh', categoryName: 'Recursos humanos', amount: '2000000.00' }] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }));

    await screen.findByRole('dialog', { name: /parte de la versión 4/ });
    expect((screen.getByLabelText('Total del presupuesto') as HTMLInputElement).value).toBe('2000000.00'); // lo editado antes se descartó
    expect(screen.getAllByLabelText(/^Importe/)).toHaveLength(1);
    expect(screen.queryByText('El presupuesto fue modificado por otro usuario mientras estabas editando.')).toBeNull();
    expect(api.getProjectBudget).toHaveBeenCalledTimes(2); // carga inicial + Recargar
    expect(api.createProjectBudgetVersion).toHaveBeenCalledTimes(1); // jamás se reenvió solo
    await waitFor(() => expect(screen.getAllByText('Versión 4').length).toBeGreaterThan(0)); // la vista de fondo también se actualizó
  });

  it('Cancelar en el conflicto cierra sin guardar nada', async () => {
    api.createProjectBudgetVersion.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'BUDGET_VERSION_CONFLICT'));
    await openVersionForm();
    fireEvent.change(screen.getAllByLabelText(/^Importe/)[0]!, { target: { value: '700000' } });
    fireEvent.change(screen.getAllByLabelText(/^Importe/)[1]!, { target: { value: '300000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva versión' }));
    await screen.findByRole('alert');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.createProjectBudgetVersion).toHaveBeenCalledTimes(1);
  });

  it('BUDGET_ALREADY_EXISTS al crear: es un conflicto; Recargar muestra el presupuesto que otro creó y cierra el formulario', async () => {
    api.getProjectBudget.mockRejectedValue(notFound());
    api.createProjectBudget.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'BUDGET_ALREADY_EXISTS'));
    renderSection(admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Crear presupuesto' }));
    await screen.findAllByRole('option', { name: 'Recursos humanos' });
    fireEvent.change(screen.getByLabelText('Total del presupuesto'), { target: { value: '1000000' } });
    fireEvent.change(screen.getByLabelText('Fecha de aprobación'), { target: { value: '2026-10-25' } });
    fireEvent.change(screen.getByLabelText(/^Rubro/), { target: { value: 'c-rrhh' } });
    fireEvent.change(screen.getByLabelText(/^Importe/), { target: { value: '1000000' } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await screen.findByText(/otro usuario lo creó mientras estabas editando/);
    api.getProjectBudget.mockResolvedValue(budget(1));
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }));
    await screen.findByText('Versión 1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
