// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BudgetHistoryEntry } from '@tema/shared-types';
import { ApiRequestError } from '../../lib/api';
import { BudgetHistory } from './BudgetHistory';

const { api } = vi.hoisted(() => ({ api: { getProjectBudgetHistory: vi.fn(), listCostCategories: vi.fn() } }));
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api }));

const entry = (version: number, isCurrent: boolean, extra: Partial<BudgetHistoryEntry> = {}): BudgetHistoryEntry => ({
  id: `b-${version}`, projectId: 'p1', version, totalAmount: `${version}000000.00`, currency: 'ARS', approvalDate: `2026-10-${10 + version}`, isCurrent,
  supersededAt: isCurrent ? null : '2026-10-30T10:00:00Z', createdBy: 'u1', createdAt: `2026-10-${10 + version}T10:00:00`, items: [],
  createdByUser: { id: 'u1', name: `Creador ${version}` },
  ...extra,
});

// V3 vigente, V2 y V1 históricas. V1 usa un rubro que hoy está INACTIVO (no aparece en el catálogo activo).
const HISTORY: BudgetHistoryEntry[] = [
  entry(3, true, { items: [{ costCategoryId: 'c-rrhh', categoryName: 'Recursos humanos', amount: '2000000.00' }, { costCategoryId: 'c-soft', categoryName: 'Licencias y software', amount: '1000000.00' }] }),
  entry(2, false, { currency: 'USD', totalAmount: '5000.50', items: [{ costCategoryId: 'c-rrhh', categoryName: 'Recursos humanos', amount: '5000.50' }] }),
  entry(1, false, { items: [{ costCategoryId: 'c-viejo', categoryName: 'Servicios (rubro retirado)', amount: '1000000.00' }] }),
];

function renderHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BudgetHistory projectId="p1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BudgetHistory', () => {
  it('lista V3 vigente, V2 y V1 históricas, la más nueva primero, con creador, fechas, total y moneda', async () => {
    api.getProjectBudgetHistory.mockResolvedValue(HISTORY);
    renderHistory();
    await screen.findByText('Versión 3');
    const buttons = screen.getAllByRole('button', { expanded: false });
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Versión 3'),
      expect.stringContaining('Versión 2'),
      expect.stringContaining('Versión 1'),
    ]);
    expect(buttons[0]!.textContent).toContain('● Vigente');
    expect(buttons[0]!.textContent).toContain('ARS 3.000.000,00');
    expect(buttons[0]!.textContent).toContain('Creada por Creador 3');
    expect(buttons[0]!.textContent).toContain('Aprobado el 13/10/2026');
    expect(buttons[1]!.textContent).toContain('○ Histórica');
    expect(buttons[1]!.textContent).toContain('USD 5.000,50'); // cada versión en SU moneda
    expect(buttons[2]!.textContent).toContain('○ Histórica');
  });

  it('el estado no depende solo del color: lleva texto y símbolo (Vigente / Histórica)', async () => {
    api.getProjectBudgetHistory.mockResolvedValue(HISTORY);
    renderHistory();
    await screen.findByText('Versión 3');
    expect(screen.getAllByText(/Vigente/)).toHaveLength(1);
    expect(screen.getAllByText(/Histórica/)).toHaveLength(2);
  });

  it('expandir una versión muestra SUS partidas (categoryName y monto) con aria-expanded', async () => {
    api.getProjectBudgetHistory.mockResolvedValue(HISTORY);
    renderHistory();
    await screen.findByText('Versión 3');
    const v3 = screen.getByRole('button', { name: /Versión 3/ });
    expect(v3.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(v3);
    expect(v3.getAttribute('aria-expanded')).toBe('true');
    const table = screen.getByRole('table', { name: 'Partidas de la versión 3' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(['Recursos humanosARS 2.000.000,00', 'Licencias y softwareARS 1.000.000,00']);
    fireEvent.click(v3);
    expect(screen.queryByRole('table', { name: 'Partidas de la versión 3' })).toBeNull();
  });

  it('cada versión muestra sus propias partidas, no las de otra', async () => {
    api.getProjectBudgetHistory.mockResolvedValue(HISTORY);
    renderHistory();
    await screen.findByText('Versión 3');
    fireEvent.click(screen.getByRole('button', { name: /Versión 2/ }));
    fireEvent.click(screen.getByRole('button', { name: /Versión 1/ }));
    const v2 = within(screen.getByRole('table', { name: 'Partidas de la versión 2' }));
    expect(v2.getByText('USD 5.000,50')).toBeTruthy();
    expect(v2.queryByText('Licencias y software')).toBeNull();
    expect(within(screen.getByRole('table', { name: 'Partidas de la versión 1' })).getByText('ARS 1.000.000,00')).toBeTruthy();
  });

  it('un rubro hoy inactivo sigue mostrando el nombre HISTÓRICO del snapshot, sin consultar el catálogo', async () => {
    api.getProjectBudgetHistory.mockResolvedValue(HISTORY);
    renderHistory();
    await screen.findByText('Versión 3');
    fireEvent.click(screen.getByRole('button', { name: /Versión 1/ }));
    expect(screen.getByText('Servicios (rubro retirado)')).toBeTruthy();
    expect(api.listCostCategories).not.toHaveBeenCalled();
  });

  it('sin presupuesto (BUDGET_NOT_FOUND) es vacío, no error', async () => {
    api.getProjectBudgetHistory.mockRejectedValue(new ApiRequestError(404, 'Not Found', [], 'BUDGET_NOT_FOUND'));
    renderHistory();
    await screen.findByText('No hay versiones anteriores.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('403: mensaje de permisos, sin reintentos', async () => {
    api.getProjectBudgetHistory.mockRejectedValue(new ApiRequestError(403, 'Forbidden', []));
    renderHistory();
    await screen.findByText('No tenés permisos para acceder a la información económica de este proyecto.');
    expect(api.getProjectBudgetHistory).toHaveBeenCalledTimes(1);
  });

  it('cargando', () => {
    api.getProjectBudgetHistory.mockReturnValue(new Promise(() => undefined));
    renderHistory();
    expect(screen.getByRole('status').textContent).toBe('Cargando historial…');
  });

  it('en móvil las partidas quedan en un contenedor con scroll horizontal (se pueden leer)', async () => {
    api.getProjectBudgetHistory.mockResolvedValue(HISTORY);
    renderHistory();
    await screen.findByText('Versión 3');
    fireEvent.click(screen.getByRole('button', { name: /Versión 3/ }));
    expect(screen.getByRole('table', { name: 'Partidas de la versión 3' }).parentElement!.className).toContain('overflow-x-auto');
  });
});
