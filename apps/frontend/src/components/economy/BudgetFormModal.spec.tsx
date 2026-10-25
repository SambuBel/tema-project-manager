// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Budget } from '@tema/shared-types';
import { ApiRequestError } from '../../lib/api';
import { BudgetFormModal } from './BudgetFormModal';

const { api } = vi.hoisted(() => ({
  api: {
    listCostCategories: vi.fn(),
    createProjectBudget: vi.fn(),
    createProjectBudgetVersion: vi.fn(),
  },
}));
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api }));

const CATEGORIES = [
  { id: 'c-rrhh', name: 'Recursos humanos' },
  { id: 'c-soft', name: 'Licencias y software' },
];

const current: Budget = {
  id: 'b-3', projectId: 'p1', version: 3, totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-25', isCurrent: true, supersededAt: null,
  createdBy: 'u1', createdAt: '2026-10-25T10:00:00Z',
  items: [
    { costCategoryId: 'c-rrhh', categoryName: 'Recursos humanos', amount: '600000.00' },
    { costCategoryId: 'c-soft', categoryName: 'Licencias y software', amount: '400000.00' },
  ],
};

function renderModal(props: Partial<React.ComponentProps<typeof BudgetFormModal>> = {}) {
  const onClose = vi.fn();
  const onReload = vi.fn().mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <BudgetFormModal mode="create" projectId="p1" currency="ARS" onClose={onClose} onReload={onReload} {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onClose, onReload, invalidate };
}

const field = (name: RegExp | string) => screen.getByLabelText(name) as HTMLInputElement;
const submit = () => screen.getByRole('button', { name: /Crear presupuesto|Guardar nueva versión|Guardando/ }) as HTMLButtonElement;

async function fillValidCreateForm() {
  await screen.findByRole('option', { name: 'Recursos humanos' });
  fireEvent.change(field('Total del presupuesto'), { target: { value: '1000000' } });
  fireEvent.change(field('Fecha de aprobación'), { target: { value: '2026-10-25' } });
  fireEvent.change(field(/^Rubro/), { target: { value: 'c-rrhh' } });
  fireEvent.change(field(/^Importe/), { target: { value: '600000' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Agregar partida' }));
  const rubros = screen.getAllByLabelText(/^Rubro/);
  const importes = screen.getAllByLabelText(/^Importe/);
  fireEvent.change(rubros[1]!, { target: { value: 'c-soft' } });
  fireEvent.change(importes[1]!, { target: { value: '400000' } });
}

beforeEach(() => {
  api.listCostCategories.mockResolvedValue(CATEGORIES);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BudgetFormModal - crear presupuesto', () => {
  it('es un diálogo accesible con los campos con etiqueta real y una partida inicial', async () => {
    renderModal();
    const dialog = await screen.findByRole('dialog', { name: 'Crear presupuesto' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    for (const label of ['Total del presupuesto', 'Fecha de aprobación']) expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.queryByLabelText('Moneda')).toBeNull(); // la moneda NO es un campo: es la del proyecto
    expect(screen.getByText(/Moneda del proyecto:/).textContent).toContain('ARS');
    expect(screen.getAllByLabelText(/^Rubro/)).toHaveLength(1);
    expect(field('Total del presupuesto').type).toBe('text'); // dinero: nunca type="number"
    expect(field('Total del presupuesto').getAttribute('inputmode')).toBe('decimal');
    expect(field(/^Importe/).type).toBe('text');
  });

  it('Escape cierra el diálogo', async () => {
    const { onClose } = renderModal();
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('no se puede guardar sin completar: el botón está deshabilitado y se listan los motivos', async () => {
    renderModal();
    await screen.findByRole('option', { name: 'Recursos humanos' });
    expect(submit().disabled).toBe(true);
    expect(screen.getByText('Para guardar:')).toBeTruthy();
  });

  it('suma exacta: con la suma igual al total muestra "coincide" y habilita guardar', async () => {
    renderModal();
    await fillValidCreateForm();
    expect(screen.getByText(/✓ coincide/)).toBeTruthy();
    expect(screen.getByText('Total presupuesto:').nextElementSibling?.textContent).toBe('ARS 1.000.000,00');
    expect(submit().disabled).toBe(false);
  });

  it('suma distinta: muestra cuánto FALTA, avisa y deshabilita guardar', async () => {
    renderModal();
    await fillValidCreateForm();
    fireEvent.change(screen.getAllByLabelText(/^Importe/)[1]!, { target: { value: '350000' } });
    expect(screen.getByText(/Faltan:/).textContent).toContain('ARS 50.000,00');
    expect(screen.getByText('Suma de partidas:').nextElementSibling?.textContent).toBe('ARS 950.000,00');
    expect(submit().disabled).toBe(true);
    expect(screen.getByText('La suma de las partidas debe coincidir con el total.')).toBeTruthy();
  });

  it('suma mayor al total: muestra cuánto se pasa', async () => {
    renderModal();
    await fillValidCreateForm();
    fireEvent.change(screen.getAllByLabelText(/^Importe/)[1]!, { target: { value: '400000,01' } });
    expect(screen.getByText(/Se pasan por:/).textContent).toContain('ARS 0,01');
    expect(submit().disabled).toBe(true);
  });

  it('0.10 + 0.20 contra 0.30 coincide (sin error de punto flotante)', async () => {
    renderModal();
    await screen.findByRole('option', { name: 'Recursos humanos' });
    fireEvent.change(field('Total del presupuesto'), { target: { value: '0,30' } });
    fireEvent.change(field(/^Rubro/), { target: { value: 'c-rrhh' } });
    fireEvent.change(field(/^Importe/), { target: { value: '0.10' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar partida' }));
    fireEvent.change(screen.getAllByLabelText(/^Rubro/)[1]!, { target: { value: 'c-soft' } });
    fireEvent.change(screen.getAllByLabelText(/^Importe/)[1]!, { target: { value: '0.20' } });
    expect(screen.getByText(/✓ coincide/)).toBeTruthy();
  });

  it('partidas dinámicas: agregar y eliminar; el rubro elegido en una fila se deshabilita en las demás', async () => {
    renderModal();
    await screen.findByRole('option', { name: 'Recursos humanos' });
    fireEvent.change(field(/^Rubro/), { target: { value: 'c-rrhh' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar partida' }));
    expect(screen.getAllByLabelText(/^Rubro/)).toHaveLength(2);
    const secondSelect = screen.getAllByLabelText(/^Rubro/)[1]!;
    const taken = Array.from(secondSelect.querySelectorAll('option')).find((o) => o.textContent === 'Recursos humanos') as HTMLOptionElement;
    expect(taken.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar la partida 2' }));
    expect(screen.getAllByLabelText(/^Rubro/)).toHaveLength(1);
  });

  it('no se puede enviar sin partidas', async () => {
    renderModal();
    await screen.findByRole('option', { name: 'Recursos humanos' });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar la partida 1' }));
    expect(screen.getByText('Agregá al menos una partida.')).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  it('envía importes como TEXTO canónico, SIN moneda (la deriva el backend), rubros por id; y al guardar invalida solo presupuesto e historial y cierra', async () => {
    api.createProjectBudget.mockResolvedValue({ ...current, version: 1 });
    const { onClose, invalidate } = renderModal();
    await fillValidCreateForm();
    fireEvent.change(field('Total del presupuesto'), { target: { value: '1000000,00' } });
    fireEvent.click(submit());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.createProjectBudget).toHaveBeenCalledTimes(1);
    expect(api.createProjectBudget).toHaveBeenCalledWith('p1', {
      totalAmount: '1000000.00',
      approvalDate: '2026-10-25',
      items: [{ costCategoryId: 'c-rrhh', amount: '600000.00' }, { costCategoryId: 'c-soft', amount: '400000.00' }],
    });
    expect(invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey)).toEqual([['project-budget', 'p1'], ['project-budget-history', 'p1']]);
  });

  it('mientras guarda: botón "Guardando…" deshabilitado y un solo request aunque se haga clic de nuevo', async () => {
    let resolve!: (b: Budget) => void;
    api.createProjectBudget.mockReturnValue(new Promise<Budget>((r) => (resolve = r)));
    renderModal();
    await fillValidCreateForm();
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardando…' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Guardando…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Guardando…' }));
    expect(api.createProjectBudget).toHaveBeenCalledTimes(1);
    resolve(current);
  });

  describe('errores del backend (la validación del frontend es solo ayuda)', () => {
    async function submitAndReject(error: ApiRequestError) {
      api.createProjectBudget.mockRejectedValue(error);
      const view = renderModal();
      await fillValidCreateForm();
      fireEvent.click(submit());
      await screen.findByText(/./, { selector: '[role="alert"], [role="status"]' });
      return view;
    }

    it('BUDGET_ITEMS_TOTAL_MISMATCH: mensaje con los dos importes que informa el backend', async () => {
      await submitAndReject(new ApiRequestError(400, 'Bad Request', [], 'BUDGET_ITEMS_TOTAL_MISMATCH', { totalAmount: '1000000.00', itemsTotal: '950000.00' }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('La suma de las partidas debe coincidir con el total del presupuesto.');
      expect(alert.textContent).toContain('1.000.000,00');
      expect(alert.textContent).toContain('950.000,00');
    });

    it.each([
      ['COST_CATEGORY_NOT_FOUND', 'El rubro seleccionado ya no está disponible.'],
      ['COST_CATEGORY_INACTIVE', 'El rubro seleccionado está inactivo.'],
      ['BUDGET_ITEM_DUPLICATED_CATEGORY', 'Un rubro no puede aparecer más de una vez.'],
    ])('%s → mensaje comprensible', async (code, message) => {
      await submitAndReject(new ApiRequestError(400, 'Bad Request', [], code));
      expect((await screen.findByRole('alert')).textContent).toBe(message);
    });

    it('BUDGET_NO_CHANGES: aviso suave (status), no un error rojo', async () => {
      await submitAndReject(new ApiRequestError(409, 'Conflict', [], 'BUDGET_NO_CHANGES'));
      expect((await screen.findByRole('status')).textContent).toBe('No hay cambios para guardar.');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('un error sin código muestra un mensaje genérico, sin detalles técnicos', async () => {
      await submitAndReject(new ApiRequestError(500, 'Internal Server Error', []));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).not.toMatch(/500|Internal|stack/i);
    });
  });
});

describe('BudgetFormModal - nueva versión', () => {
  it('se prellena con el vigente y el título dice desde qué versión parte', async () => {
    renderModal({ mode: 'version', current });
    await screen.findByRole('dialog', { name: /Nueva versión del presupuesto \(parte de la versión 3\)/ });
    expect(field('Total del presupuesto').value).toBe('1000000.00');
    expect(screen.getByText(/Moneda del proyecto:/).textContent).toContain('ARS');
    expect(field('Fecha de aprobación').value).toBe('2026-10-25');
    expect((screen.getAllByLabelText(/^Importe/) as HTMLInputElement[]).map((i) => i.value)).toEqual(['600000.00', '400000.00']);
    await screen.findByText(/✓ coincide/);
  });

  it('envía expectedVersion = versión vigente y las partidas editadas', async () => {
    api.createProjectBudgetVersion.mockResolvedValue({ ...current, version: 4 });
    const { onClose } = renderModal({ mode: 'version', current });
    await screen.findByText(/✓ coincide/);
    fireEvent.change(screen.getAllByLabelText(/^Importe/)[0]!, { target: { value: '700000' } });
    fireEvent.change(screen.getAllByLabelText(/^Importe/)[1]!, { target: { value: '300000' } });
    fireEvent.click(submit());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.createProjectBudgetVersion).toHaveBeenCalledWith('p1', {
      expectedVersion: 3,
      totalAmount: '1000000.00',
      approvalDate: '2026-10-25',
      items: [{ costCategoryId: 'c-rrhh', amount: '700000.00' }, { costCategoryId: 'c-soft', amount: '300000.00' }],
    });
  });

  it('MONEDA ÚNICA: no hay forma de cambiar la moneda en una versión nueva, ni aviso de conversión', async () => {
    renderModal({ mode: 'version', current });
    await screen.findByText(/✓ coincide/);
    expect(screen.queryByLabelText('Moneda')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /moneda/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/conversion|nueva moneda/i);
    expect(screen.getByText(/Moneda del proyecto:/).textContent).toContain('ARS');
  });

  it('en un proyecto USD la moneda mostrada es USD (derivada del proyecto), junto al total', async () => {
    renderModal({ currency: 'USD' });
    await screen.findByRole('option', { name: 'Recursos humanos' });
    expect(screen.getByText(/Moneda del proyecto:/).textContent).toContain('USD');
    expect(field('Total del presupuesto').parentElement!.textContent).toContain('USD');
  });

  describe('rubro del vigente que ya no está activo', () => {
    const withInactive: Budget = {
      ...current,
      items: [
        { costCategoryId: 'c-rrhh', categoryName: 'Recursos humanos', amount: '600000.00' },
        { costCategoryId: 'c-viejo', categoryName: 'Licencias heredadas', amount: '400000.00' },
      ],
    };

    it('la partida sigue visible con su nombre histórico e importe, marcada como inactiva, y bloquea guardar', async () => {
      renderModal({ mode: 'version', current: withInactive });
      await screen.findAllByRole('option', { name: 'Licencias y software' }); // el catálogo ya cargó
      expect(await screen.findByRole('option', { name: /Licencias heredadas — rubro inactivo \(no disponible para nuevas versiones\)/ })).toBeTruthy();
      expect((screen.getAllByLabelText(/^Importe/) as HTMLInputElement[]).map((i) => i.value)).toEqual(['600000.00', '400000.00']);
      expect(screen.getByText(/Este rubro está inactivo y no se puede usar en una versión nueva/)).toBeTruthy();
      expect(screen.getByText('Reemplazá o eliminá las partidas con rubro inactivo.')).toBeTruthy();
      expect(submit().disabled).toBe(true);
    });

    it('NO la reemplaza ni la borra automáticamente: sigue seleccionada hasta que el usuario decida', async () => {
      renderModal({ mode: 'version', current: withInactive });
      await screen.findAllByRole('option', { name: 'Licencias y software' });
      await screen.findByRole('option', { name: /Licencias heredadas/ });
      expect((screen.getAllByLabelText(/^Rubro/) as HTMLSelectElement[]).map((s) => s.value)).toEqual(['c-rrhh', 'c-viejo']);
      expect(screen.getAllByLabelText(/^Importe/)).toHaveLength(2);
    });

    it('el usuario la sustituye por un rubro activo y puede guardar', async () => {
      api.createProjectBudgetVersion.mockResolvedValue({ ...current, version: 4 });
      const { onClose } = renderModal({ mode: 'version', current: withInactive });
      await screen.findAllByRole('option', { name: 'Licencias y software' });
      await screen.findByRole('option', { name: /Licencias heredadas/ });
      fireEvent.change(screen.getAllByLabelText(/^Rubro/)[1]!, { target: { value: 'c-soft' } });
      expect(submit().disabled).toBe(false);
      fireEvent.click(submit());
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(api.createProjectBudgetVersion.mock.calls[0]![1].items).toEqual([{ costCategoryId: 'c-rrhh', amount: '600000.00' }, { costCategoryId: 'c-soft', amount: '400000.00' }]);
    });

    it('o la elimina y reparte el total en lo que queda', async () => {
      renderModal({ mode: 'version', current: withInactive });
      await screen.findAllByRole('option', { name: 'Licencias y software' });
      await screen.findByRole('option', { name: /Licencias heredadas/ });
      fireEvent.click(screen.getByRole('button', { name: 'Eliminar la partida 2' }));
      fireEvent.change(screen.getAllByLabelText(/^Importe/)[0]!, { target: { value: '1000000' } });
      expect(submit().disabled).toBe(false);
    });
  });

  describe('BUDGET_VERSION_CONFLICT', () => {
    async function conflict() {
      api.createProjectBudgetVersion.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'BUDGET_VERSION_CONFLICT', { currentVersion: 4 }));
      const view = renderModal({ mode: 'version', current });
      await screen.findByText(/✓ coincide/);
      fireEvent.change(screen.getAllByLabelText(/^Importe/)[0]!, { target: { value: '700000' } });
      fireEvent.change(screen.getAllByLabelText(/^Importe/)[1]!, { target: { value: '300000' } });
      fireEvent.click(submit());
      await screen.findByText('El presupuesto fue modificado por otro usuario mientras estabas editando.');
      return view;
    }

    it('muestra el aviso con Recargar y Cancelar, y NO reintenta solo', async () => {
      await conflict();
      expect(screen.getByRole('button', { name: 'Recargar' })).toBeTruthy();
      expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Cancelar' })).toBeTruthy();
      await new Promise((r) => setTimeout(r, 50));
      expect(api.createProjectBudgetVersion).toHaveBeenCalledTimes(1);
    });

    it('con el conflicto abierto no se puede volver a guardar (nunca last-write-wins)', async () => {
      await conflict();
      expect(submit().disabled).toBe(true);
      fireEvent.click(submit());
      expect(api.createProjectBudgetVersion).toHaveBeenCalledTimes(1);
    });

    it('Recargar pide el vigente (onReload) y no dispara ninguna mutación', async () => {
      const { onReload } = await conflict();
      fireEvent.click(screen.getByRole('button', { name: 'Recargar' }));
      await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
      expect(api.createProjectBudgetVersion).toHaveBeenCalledTimes(1);
    });

    it('Cancelar cierra y descarta lo editado', async () => {
      const { onClose } = await conflict();
      fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Cancelar' }));
      expect(onClose).toHaveBeenCalled();
    });

    it('si recargar falla, lo informa en el mismo diálogo', async () => {
      const { onReload } = await conflict();
      onReload.mockRejectedValueOnce(new ApiRequestError(403, 'Forbidden', []));
      fireEvent.click(screen.getByRole('button', { name: 'Recargar' }));
      await screen.findByText('No tenés permisos para acceder a la información económica de este proyecto.');
    });
  });
});


describe('estado al abrir y cerrar', () => {
  it('mientras carga el catálogo NO se marca ninguna partida prellenada como inactiva (y no se puede guardar todavía)', async () => {
    let resolve!: (c: typeof CATEGORIES) => void;
    api.listCostCategories.mockReturnValue(new Promise((r) => (resolve = r)));
    renderModal({ mode: 'version', current });
    await screen.findByText('Cargando rubros…');
    expect(screen.queryByText(/rubro inactivo/)).toBeNull();
    expect(submit().disabled).toBe(true);
    resolve(CATEGORIES);
    await screen.findAllByRole('option', { name: 'Recursos humanos' });
    expect(screen.queryByText(/rubro inactivo/)).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('cada apertura arranca con estado nuevo: la creación nunca arrastra datos de un intento anterior', async () => {
    const first = renderModal();
    await fillValidCreateForm();
    first.unmount();
    renderModal();
    await screen.findByRole('option', { name: 'Recursos humanos' });
    expect(field('Total del presupuesto').value).toBe('');
  });

  it('la nueva versión se arma desde el vigente MÁS RECIENTE que recibe', async () => {
    const first = renderModal({ mode: 'version', current });
    await screen.findByText(/✓ coincide/);
    first.unmount();
    renderModal({ mode: 'version', current: { ...current, version: 4, totalAmount: '2000000.00', items: [{ costCategoryId: 'c-rrhh', categoryName: 'Recursos humanos', amount: '2000000.00' }] } });
    await screen.findByRole('dialog', { name: /versión 4/ });
    expect(field('Total del presupuesto').value).toBe('2000000.00');
    expect(screen.getAllByLabelText(/^Importe/)).toHaveLength(1);
  });
});
