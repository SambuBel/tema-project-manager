// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, Budget, Cost, PaginatedResponse, Project, RoleName } from '@tema/shared-types';
import { ApiRequestError } from '../../lib/api';
import { CostsSection } from './CostsSection';

const { api } = vi.hoisted(() => ({
  api: { listProjectCosts: vi.fn(), getProjectCost: vi.fn(), createProjectCost: vi.fn(), updateProjectCost: vi.fn(), getProjectBudget: vi.fn(), listAllTasks: vi.fn() },
}));
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api }));

const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({ id, email: `${id}@tema.test`, name: id, avatarUrl: null, roles });
const admin = user('u-admin', ['ADMIN']);
const pm = user('u-pm', ['PROGRAM_MANAGER']);
const leader = user('u-leader', ['PROJECT_LEADER']);
const project = { id: 'p1', slug: 'proyecto-uno', name: 'Proyecto Uno', leaderId: 'u-leader', economicCurrency: 'ARS' } as unknown as Project;

const cost = (n: number, extra: Partial<Cost> = {}): Cost => ({
  id: `c${n}`, projectId: 'p1', taskId: null, taskTitle: null, costCategoryId: 'cat-rrhh', categoryName: 'Recursos humanos', amount: '10000.00', currency: 'ARS',
  costDate: '2026-10-20', description: `Costo ${n}`, createdBy: 'u1', createdByUser: { id: 'u1', name: 'Ana Pérez' }, createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z', revision: 1, ...extra,
});
const pageOf = (data: Cost[], page = 1, total = data.length, limit = 10): PaginatedResponse<Cost> => ({ data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
const budget = { id: 'b1', version: 1, items: [{ costCategoryId: 'cat-rrhh', categoryName: 'Recursos humanos', amount: '1.00' }] } as unknown as Budget;

function renderSection(me: AuthenticatedUser) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['auth', 'me'], me);
  const view = render(
    <QueryClientProvider client={client}>
      <CostsSection project={project} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  api.getProjectBudget.mockResolvedValue(budget);
  api.listAllTasks.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('CostsSection - listado', () => {
  it('cargando', () => {
    api.listProjectCosts.mockReturnValue(new Promise(() => undefined));
    renderSection(admin);
    expect(screen.getByRole('status').textContent).toBe('Cargando costos…');
  });

  it('pide la página 1 con el límite del contrato, con el UUID del proyecto', async () => {
    api.listProjectCosts.mockResolvedValue(pageOf([cost(1)]));
    renderSection(admin);
    await screen.findByRole('table', { name: 'Costos del proyecto' });
    expect(api.listProjectCosts).toHaveBeenCalledWith('p1', { page: 1, limit: 10 });
  });

  it('vacío: "No hay costos registrados." y botón "Registrar costo" para quien administra', async () => {
    api.listProjectCosts.mockResolvedValue(pageOf([], 1, 0));
    renderSection(pm);
    await screen.findByText('No hay costos registrados.');
    expect(screen.getAllByRole('button', { name: 'Registrar costo' })).toHaveLength(1);
  });

  it('desktop: columnas, fila con fecha formateada, rubro, descripción, "Sin tarea", monto sin moneda, moneda y creador', async () => {
    api.listProjectCosts.mockResolvedValue(pageOf([cost(1, { amount: '1250.50', currency: 'USD' })]));
    renderSection(admin);
    const table = await screen.findByRole('table', { name: 'Costos del proyecto' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Fecha', 'Rubro', 'Descripción', 'Tarea', 'Monto', 'Moneda', 'Creado por', 'Acciones']);
    const cells = within(within(table).getAllByRole('row')[1]!).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(0, 7)).toEqual(['20/10/2026', 'Recursos humanos', 'Costo 1', 'Sin tarea', '1.250,50', 'USD', 'Ana Pérez']);
  });

  it('muestra el título de la tarea cuando el costo la tiene (sin consultar tareas una por una)', async () => {
    api.listProjectCosts.mockResolvedValue(pageOf([cost(1, { taskId: 't1', taskTitle: 'Diseño de pantallas' })]));
    renderSection(admin);
    const table = await screen.findByRole('table', { name: 'Costos del proyecto' });
    expect(within(table).getByText('Diseño de pantallas')).toBeTruthy();
    expect(api.listAllTasks).not.toHaveBeenCalled(); // las tareas se piden recién al abrir el formulario
  });

  it('mobile: una card por costo con fecha, rubro, descripción, monto y moneda, y acción Editar', async () => {
    api.listProjectCosts.mockResolvedValue(pageOf([cost(1, { amount: '50.00', currency: 'USD' }), cost(2)]));
    renderSection(admin);
    await screen.findByRole('table', { name: 'Costos del proyecto' });
    const list = document.querySelector('ul.sm\\:hidden')!;
    const cards = within(list as HTMLElement).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Recursos humanos');
    expect(cards[0]!.textContent).toContain('Costo 1');
    expect(cards[0]!.textContent).toContain('50,00');
    expect(cards[0]!.textContent).toContain('USD');
    expect(cards[0]!.textContent).toContain('20/10/2026');
    expect(within(cards[0]!).getByRole('button', { name: 'Editar costo: Costo 1' })).toBeTruthy();
    // estructura: tabla solo desde sm, cards solo en móvil
    expect(screen.getByRole('table', { name: 'Costos del proyecto' }).parentElement!.className).toMatch(/hidden .*sm:block/);
  });

  it('NO hay eliminación ni indicadores sin definir (disponible, comprometido, ejecución, programado)', async () => {
    api.listProjectCosts.mockResolvedValue(pageOf([cost(1, { costDate: '2999-01-01' })]));
    renderSection(admin);
    await screen.findByRole('table', { name: 'Costos del proyecto' });
    expect(screen.queryByRole('button', { name: /eliminar|borrar/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/disponible|comprometido|ejecuci[oó]n|programad/i);
  });
});

describe('CostsSection - paginación (la hace el backend)', () => {
  beforeEach(() => {
    api.listProjectCosts.mockImplementation(async (_id: string, { page }: { page: number }) =>
      pageOf(Array.from({ length: 10 }, (_, i) => cost((page - 1) * 10 + i + 1)), page, 25),
    );
  });

  it('muestra el total y pide solo la página elegida, sin cargar todo', async () => {
    renderSection(admin);
    await screen.findByText('25 costos registrados');
    expect(api.listProjectCosts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await screen.findAllByText('Costo 11');
    expect(api.listProjectCosts).toHaveBeenLastCalledWith('p1', { page: 2, limit: 10 });
    expect(api.listProjectCosts).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Costo 1')).toBeNull();
  });

  it('Anterior / Siguiente', async () => {
    renderSection(admin);
    await screen.findByText('25 costos registrados');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findAllByText('Costo 11');
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await waitFor(() => expect(api.listProjectCosts).toHaveBeenLastCalledWith('p1', { page: 1, limit: 10 }));
  });

  it('una sola página: no hay paginador', async () => {
    api.listProjectCosts.mockResolvedValue(pageOf([cost(1)]));
    renderSection(admin);
    await screen.findByRole('table', { name: 'Costos del proyecto' });
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull();
  });
});

describe('CostsSection - permisos', () => {
  beforeEach(() => {
    api.listProjectCosts.mockResolvedValue(pageOf([cost(1)]));
  });

  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real', leader]])('%s: ve "Registrar costo" y "Editar"', async (_n, me) => {
    renderSection(me);
    await screen.findByRole('table', { name: 'Costos del proyecto' });
    expect(screen.getByRole('button', { name: 'Registrar costo' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Editar costo: Costo 1' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: 'Acciones' })).toBeTruthy();
  });

  it.each([['líder ajeno', user('otro', ['PROJECT_LEADER'])], ['COLLABORATOR', user('c', ['COLLABORATOR'])], ['OBSERVER', user('o', ['OBSERVER'])]])(
    '%s: aunque llegara acá, no ve acciones de escritura',
    async (_n, me) => {
      renderSection(me);
      await screen.findByRole('table', { name: 'Costos del proyecto' });
      expect(screen.queryByRole('button', { name: 'Registrar costo' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Editar/ })).toBeNull();
      expect(screen.queryByRole('columnheader', { name: 'Acciones' })).toBeNull();
    },
  );

  it('solo lectura y vacío: sin botón', async () => {
    api.listProjectCosts.mockResolvedValue(pageOf([], 1, 0));
    renderSection(user('c', ['COLLABORATOR']));
    await screen.findByText('No hay costos registrados.');
    expect(screen.queryByRole('button', { name: 'Registrar costo' })).toBeNull();
  });
});

describe('CostsSection - errores (el error manda sobre la caché)', () => {
  it('403: mensaje de permisos, SIN la tabla vieja que había en caché y sin reintentos', async () => {
    api.listProjectCosts.mockRejectedValue(new ApiRequestError(403, 'Forbidden', []));
    const { client } = renderSection(admin);
    client.setQueryData(['project-costs', 'p1', { page: 1, limit: 10 }], pageOf([cost(1)]));
    await screen.findByText('No tenés permisos para acceder a la información económica de este proyecto.');
    expect(screen.queryByText('Costo 1')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Registrar costo' })).toBeNull();
    expect(api.listProjectCosts).toHaveBeenCalledTimes(1);
  });

  it('error genérico: mensaje y Reintentar', async () => {
    api.listProjectCosts.mockRejectedValueOnce(new ApiRequestError(400, 'Bad Request', ['limit inválido'])).mockResolvedValue(pageOf([cost(1)]));
    renderSection(admin);
    expect((await screen.findByRole('alert')).textContent).toContain('limit inválido');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('table', { name: 'Costos del proyecto' });
  });
});

describe('CostsSection - crear / editar desde la lista', () => {
  it('registrar un costo: tras guardar se vuelve a pedir la lista (no se inserta una copia parcial)', async () => {
    api.listProjectCosts.mockResolvedValue(pageOf([], 1, 0));
    api.createProjectCost.mockImplementation(async () => {
      api.listProjectCosts.mockResolvedValue(pageOf([cost(7, { description: 'Recién creado' })]));
      return cost(7);
    });
    renderSection(admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar costo' }));
    await screen.findByRole('option', { name: 'Recursos humanos' });
    const input = (label: string) => screen.getByLabelText(label);
    fireEvent.change(input('Fecha'), { target: { value: '2026-10-25' } });
    fireEvent.change(input('Monto'), { target: { value: '10000' } });
    fireEvent.change(input('Rubro'), { target: { value: 'cat-rrhh' } });
    fireEvent.change(input('Descripción'), { target: { value: 'Recién creado' } });
    fireEvent.submit(document.querySelector('form')!);
    await screen.findAllByText('Recién creado');
    expect(api.listProjectCosts).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Editar abre el formulario con el detalle actual (no con la fila de la lista) y al guardar refresca la lista', async () => {
    api.listProjectCosts.mockResolvedValue(pageOf([cost(1, { amount: '10000.00', revision: 1 })]));
    api.getProjectCost.mockResolvedValue(cost(1, { amount: '10500.00', revision: 3 })); // alguien lo editó después de listar
    api.updateProjectCost.mockResolvedValue(cost(1, { revision: 4 }));
    renderSection(admin);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Editar costo: Costo 1' }))[0]!);
    await screen.findByRole('dialog', { name: 'Editar costo' });
    await screen.findByDisplayValue('10500.00');
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Costo 1 corregido' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.updateProjectCost).toHaveBeenCalledWith('p1', 'c1', { expectedRevision: 3, description: 'Costo 1 corregido' });
    expect(api.listProjectCosts).toHaveBeenCalledTimes(2);
  });
});
