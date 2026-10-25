// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Budget, Cost, Project } from '@tema/shared-types';
import { ApiRequestError } from '../../lib/api';
import { CostFormModal } from './CostFormModal';

const { api } = vi.hoisted(() => ({
  api: { getProjectBudget: vi.fn(), listAllTasks: vi.fn(), getProjectCost: vi.fn(), createProjectCost: vi.fn(), updateProjectCost: vi.fn() },
}));
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api }));

const project = { id: 'p1', slug: 'proyecto-uno', name: 'Proyecto Uno', leaderId: 'u-leader', economicCurrency: 'ARS' } as unknown as Project;

const budget: Budget = {
  id: 'b1', projectId: 'p1', version: 2, totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-01', isCurrent: true, supersededAt: null,
  createdBy: 'u1', createdAt: '2026-10-01T10:00:00Z',
  items: [
    { costCategoryId: 'cat-rrhh', categoryName: 'Recursos humanos', amount: '600000.00' },
    { costCategoryId: 'cat-soft', categoryName: 'Licencias y software', amount: '400000.00' },
  ],
};
const cost = (extra: Partial<Cost> = {}): Cost => ({
  id: 'c1', projectId: 'p1', taskId: 't1', taskTitle: 'Tarea uno', costCategoryId: 'cat-rrhh', categoryName: 'Recursos humanos', amount: '10000.00', currency: 'ARS',
  costDate: '2026-10-20', description: 'Honorarios', createdBy: 'u1', createdByUser: { id: 'u1', name: 'Ana' }, createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z', revision: 4, ...extra,
});
const beforeStart = (data: Record<string, unknown> = { costDate: '2020-01-01', projectStartDate: '2026-01-01' }) =>
  new ApiRequestError(409, 'Conflict', [], 'COST_BEFORE_PROJECT_START_CONFIRMATION_REQUIRED', data);

function renderModal(props: { mode: 'create' | 'edit'; costId?: string }, onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <CostFormModal {...props} project={project} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { client, invalidate, onClose };
}
const form = () => document.querySelector('form')!;
const submit = () => fireEvent.submit(form());
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

async function fillCreate(over: { amount?: string; date?: string } = {}) {
  await screen.findByRole('option', { name: 'Recursos humanos' });
  await screen.findByRole('option', { name: 'Tarea uno' });
  fireEvent.change(input('Fecha'), { target: { value: over.date ?? '2026-10-25' } });
  fireEvent.change(input('Monto'), { target: { value: over.amount ?? '10000' } });
  fireEvent.change(input('Rubro'), { target: { value: 'cat-rrhh' } });
  fireEvent.change(input('Descripción'), { target: { value: '  Honorarios octubre ' } });
}

beforeEach(() => {
  api.getProjectBudget.mockResolvedValue(budget);
  api.listAllTasks.mockResolvedValue([{ id: 't1', title: 'Tarea uno' }, { id: 't2', title: 'Tarea dos' }]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.resetAllMocks();
});

describe('CostFormModal - crear', () => {
  it('ofrece SOLO los rubros del presupuesto vigente y las tareas del proyecto (Sin tarea por defecto)', async () => {
    renderModal({ mode: 'create' });
    await screen.findByRole('option', { name: 'Licencias y software' });
    await screen.findByRole('option', { name: 'Tarea dos' });
    expect(within(input('Rubro')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Elegí un rubro…', 'Recursos humanos', 'Licencias y software']);
    expect(input('Tarea (opcional)').value).toBe('');
    expect(within(input('Tarea (opcional)')).getAllByRole('option')[0]!.textContent).toBe('Sin tarea');
    expect(api.listAllTasks).toHaveBeenCalledWith({ projectId: 'p1' }); // misma fuente de tareas que el tablero
  });

  it('el monto es un campo de texto decimal (no number) y la fecha arranca en hoy', async () => {
    renderModal({ mode: 'create' });
    await screen.findByRole('option', { name: 'Recursos humanos' });
    expect(input('Monto').type).toBe('text');
    expect(input('Monto').getAttribute('inputmode')).toBe('decimal');
    expect(input('Fecha').type).toBe('date');
    expect(input('Fecha').value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('envía monto STRING, moneda en mayúsculas, descripción recortada, sin taskId ni confirmación; invalida solo la lista', async () => {
    api.createProjectCost.mockResolvedValue(cost());
    const { invalidate, onClose } = renderModal({ mode: 'create' });
    await fillCreate();
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.createProjectCost).toHaveBeenCalledTimes(1);
    const [projectId, dto] = api.createProjectCost.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(dto).toEqual({ costDate: '2026-10-25', amount: '10000.00', costCategoryId: 'cat-rrhh', description: 'Honorarios octubre' });
    expect('currency' in dto).toBe(false); // la moneda la deriva el backend desde el proyecto
    expect(typeof dto.amount).toBe('string');
    const invalidated = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(invalidated).toEqual([['project-costs', 'p1']]); // ni presupuesto ni historial
  });

  it('con tarea elegida envía taskId', async () => {
    api.createProjectCost.mockResolvedValue(cost());
    renderModal({ mode: 'create' });
    await fillCreate();
    fireEvent.change(input('Tarea (opcional)'), { target: { value: 't2' } });
    submit();
    await waitFor(() => expect(api.createProjectCost).toHaveBeenCalled());
    expect(api.createProjectCost.mock.calls[0]![1]).toMatchObject({ taskId: 't2' });
  });

  it('un monto mayor al presupuesto no se bloquea (RN-19)', async () => {
    api.createProjectCost.mockResolvedValue(cost());
    renderModal({ mode: 'create' });
    await fillCreate({ amount: '99999999,5' });
    expect((screen.getByRole('button', { name: 'Registrar costo' }) as HTMLButtonElement).disabled).toBe(false);
    submit();
    await waitFor(() => expect(api.createProjectCost).toHaveBeenCalled());
    expect(api.createProjectCost.mock.calls[0]![1]).toMatchObject({ amount: '99999999.50' });
  });

  it('MONEDA ÚNICA: no hay input de moneda; se muestra la del proyecto (ARS) junto al monto', async () => {
    renderModal({ mode: 'create' });
    await screen.findByRole('option', { name: 'Recursos humanos' });
    expect(screen.queryByLabelText('Moneda')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /moneda/i })).toBeNull();
    expect(screen.getByText('Moneda del proyecto: ARS')).toBeTruthy();
    expect(input('Monto').parentElement!.textContent).toContain('ARS');
  });

  it('en un proyecto USD muestra USD y tampoco envía moneda', async () => {
    api.createProjectCost.mockResolvedValue(cost({ currency: 'USD' }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CostFormModal mode="create" project={{ ...project, economicCurrency: 'USD' } as Project} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    await fillCreate();
    expect(screen.getByText('Moneda del proyecto: USD')).toBeTruthy();
    submit();
    await waitFor(() => expect(api.createProjectCost).toHaveBeenCalled());
    expect('currency' in api.createProjectCost.mock.calls[0]![1]).toBe(false);
  });

  it('PROJECT_CURRENCY_MISMATCH del backend: mensaje claro con la moneda del proyecto', async () => {
    api.createProjectCost.mockRejectedValue(new ApiRequestError(400, 'Bad Request', [], 'PROJECT_CURRENCY_MISMATCH', { projectCurrency: 'ARS' }));
    renderModal({ mode: 'create' });
    await fillCreate();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Los importes deben expresarse en la moneda del proyecto (ARS).');
  });

  it('una fecha futura no se bloquea', async () => {
    api.createProjectCost.mockResolvedValue(cost());
    renderModal({ mode: 'create' });
    await fillCreate({ date: '2999-01-01' });
    submit();
    await waitFor(() => expect(api.createProjectCost).toHaveBeenCalled());
  });

  it('formulario inválido: no envía y muestra qué falta', async () => {
    renderModal({ mode: 'create' });
    await screen.findByRole('option', { name: 'Recursos humanos' });
    expect((screen.getByRole('button', { name: 'Registrar costo' }) as HTMLButtonElement).disabled).toBe(true);
    submit();
    expect(api.createProjectCost).not.toHaveBeenCalled();
    expect(screen.getByText('Para guardar:')).toBeTruthy();
    fireEvent.change(input('Monto'), { target: { value: '12abc' } });
    expect(screen.getAllByText(/El importe debe ser un número sin signo/).length).toBeGreaterThan(0);
    expect(input('Monto').getAttribute('aria-invalid')).toBe('true');
    expect(input('Monto').getAttribute('aria-describedby')).toBeTruthy();
  });

  it('sin presupuesto vigente: explica que no se puede registrar y no ofrece el formulario ni inventa rubros', async () => {
    api.getProjectBudget.mockRejectedValue(new ApiRequestError(404, 'Not Found', [], 'BUDGET_NOT_FOUND'));
    renderModal({ mode: 'create' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('no tiene un presupuesto vigente con rubros disponibles');
    expect(document.querySelector('form')).toBeNull();
  });

  it('error de validación del backend (rubro fuera del presupuesto): mensaje claro y el formulario sigue abierto', async () => {
    api.createProjectCost.mockRejectedValue(new ApiRequestError(400, 'Bad Request', [], 'COST_CATEGORY_NOT_IN_CURRENT_BUDGET'));
    const { onClose } = renderModal({ mode: 'create' });
    await fillCreate();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Este rubro no forma parte del presupuesto vigente.');
    expect(onClose).not.toHaveBeenCalled();
    expect(form()).toBeTruthy();
  });

  it('mientras guarda, el formulario queda deshabilitado (sin doble envío)', async () => {
    api.createProjectCost.mockReturnValue(new Promise(() => undefined));
    renderModal({ mode: 'create' });
    await fillCreate();
    submit();
    await screen.findByRole('button', { name: 'Guardando…' });
    expect((screen.getByRole('button', { name: 'Guardando…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(input('Monto').matches(':disabled')).toBe(true); // el <fieldset disabled> deshabilita todo lo que contiene
    submit();
    expect(api.createProjectCost).toHaveBeenCalledTimes(1);
  });

  it('accesibilidad: dialog modal con nombre, foco inicial y Escape cierra', async () => {
    const { onClose } = renderModal({ mode: 'create' });
    const dialog = await screen.findByRole('dialog', { name: 'Registrar costo' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('CostFormModal - RN-21 (fecha anterior al inicio del proyecto)', () => {
  it('el primer envío NO lleva confirmación; el 409 abre el diálogo con ambas fechas', async () => {
    api.createProjectCost.mockRejectedValue(beforeStart());
    const { onClose } = renderModal({ mode: 'create' });
    await fillCreate({ date: '2020-01-01' });
    submit();
    const dialog = await screen.findByRole('alertdialog');
    expect(api.createProjectCost.mock.calls[0]![1]).not.toHaveProperty('confirmBeforeProjectStart');
    expect(dialog.textContent).toContain('La fecha del costo es anterior al inicio del proyecto.');
    expect(within(dialog).getByText('Fecha del costo:').nextSibling?.textContent).toBe('01/01/2020');
    expect(within(dialog).getByText('Inicio del proyecto:').nextSibling?.textContent).toBe('01/01/2026');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancelar no reenvía y deja el formulario con lo cargado', async () => {
    api.createProjectCost.mockRejectedValue(beforeStart());
    renderModal({ mode: 'create' });
    await fillCreate({ date: '2020-01-01' });
    submit();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.createProjectCost).toHaveBeenCalledTimes(1);
    expect(input('Monto').value).toBe('10000');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Escape sobre la confirmación cierra solo la confirmación, no el formulario', async () => {
    api.createProjectCost.mockRejectedValue(beforeStart());
    const { onClose } = renderModal({ mode: 'create' });
    await fillCreate({ date: '2020-01-01' });
    submit();
    await screen.findByRole('alertdialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(form()).toBeTruthy();
  });

  it('"Registrar igualmente" reenvía EXACTAMENTE una vez, con confirmBeforeProjectStart=true, y cierra', async () => {
    api.createProjectCost.mockRejectedValueOnce(beforeStart()).mockResolvedValueOnce(cost());
    const { onClose } = renderModal({ mode: 'create' });
    await fillCreate({ date: '2020-01-01' });
    submit();
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Registrar igualmente' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.createProjectCost).toHaveBeenCalledTimes(2);
    const [first, second] = api.createProjectCost.mock.calls.map((c) => c[1]);
    expect(first).not.toHaveProperty('confirmBeforeProjectStart');
    expect(second).toEqual({ ...first, confirmBeforeProjectStart: true });
  });

  it('si aun confirmado el backend vuelve a pedirla: no hay bucle, se muestra como problema', async () => {
    api.createProjectCost.mockRejectedValue(beforeStart());
    renderModal({ mode: 'create' });
    await fillCreate({ date: '2020-01-01' });
    submit();
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Registrar igualmente' }));
    await screen.findByRole('alert');
    expect(api.createProjectCost).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('sin inicio de proyecto en el error: muestra solo la fecha del costo', async () => {
    api.createProjectCost.mockRejectedValue(beforeStart({ costDate: '2020-01-01' }));
    renderModal({ mode: 'create' });
    await fillCreate({ date: '2020-01-01' });
    submit();
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Fecha del costo:').nextSibling?.textContent).toBe('01/01/2020');
    expect(dialog.textContent).not.toContain('Inicio del proyecto:');
  });

  it('en la edición también aplica: PATCH → 409 → confirmar → un solo reenvío con la confirmación', async () => {
    api.getProjectCost.mockResolvedValue(cost());
    api.updateProjectCost.mockRejectedValueOnce(beforeStart()).mockResolvedValueOnce(cost({ revision: 5 }));
    const { onClose } = renderModal({ mode: 'edit', costId: 'c1' });
    await screen.findByDisplayValue('Honorarios');
    fireEvent.change(input('Fecha'), { target: { value: '2020-01-01' } });
    submit();
    const dialog = await screen.findByRole('alertdialog');
    expect(api.updateProjectCost.mock.calls[0]![2]).toEqual({ expectedRevision: 4, costDate: '2020-01-01' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar igualmente' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.updateProjectCost).toHaveBeenCalledTimes(2);
    expect(api.updateProjectCost.mock.calls[1]![2]).toEqual({ expectedRevision: 4, costDate: '2020-01-01', confirmBeforeProjectStart: true });
  });
});

describe('CostFormModal - editar', () => {
  it('pide el detalle actual y prellena todos los campos', async () => {
    api.getProjectCost.mockResolvedValue(cost());
    renderModal({ mode: 'edit', costId: 'c1' });
    expect(screen.getByRole('status').textContent).toBe('Cargando costo…');
    await screen.findByDisplayValue('Honorarios');
    expect(api.getProjectCost).toHaveBeenCalledWith('p1', 'c1');
    expect(input('Fecha').value).toBe('2026-10-20');
    expect(input('Monto').value).toBe('10000.00');
    expect(screen.getByText('Moneda del proyecto: ARS')).toBeTruthy();
    await screen.findByRole('option', { name: 'Tarea uno' });
    expect(input('Rubro').value).toBe('cat-rrhh');
    expect(input('Tarea (opcional)').value).toBe('t1');
    expect(screen.getByRole('dialog', { name: 'Editar costo' })).toBeTruthy();
  });

  it('patch parcial con expectedRevision del detalle; invalida lista y detalle', async () => {
    api.getProjectCost.mockResolvedValue(cost());
    api.updateProjectCost.mockResolvedValue(cost({ revision: 5, amount: '12000.00' }));
    const { invalidate, onClose } = renderModal({ mode: 'edit', costId: 'c1' });
    await screen.findByDisplayValue('Honorarios');
    fireEvent.change(input('Monto'), { target: { value: '12000' } });
    fireEvent.change(input('Descripción'), { target: { value: 'Honorarios ajustados' } });
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.updateProjectCost).toHaveBeenCalledWith('p1', 'c1', { expectedRevision: 4, amount: '12000.00', description: 'Honorarios ajustados' });
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual([['project-costs', 'p1'], ['project-cost', 'p1', 'c1']]);
  });

  it('cambiar de rubro envía el nuevo costCategoryId; cambiar la fecha también', async () => {
    api.getProjectCost.mockResolvedValue(cost());
    api.updateProjectCost.mockResolvedValue(cost({ revision: 5 }));
    renderModal({ mode: 'edit', costId: 'c1' });
    await screen.findByRole('option', { name: 'Licencias y software' });
    fireEvent.change(input('Rubro'), { target: { value: 'cat-soft' } });
    fireEvent.change(input('Fecha'), { target: { value: '2026-10-21' } });
    submit();
    await waitFor(() => expect(api.updateProjectCost).toHaveBeenCalled());
    expect(api.updateProjectCost.mock.calls[0]![2]).toEqual({ expectedRevision: 4, costCategoryId: 'cat-soft', costDate: '2026-10-21' });
  });

  it('"Sin tarea" quita la tarea con taskId null', async () => {
    api.getProjectCost.mockResolvedValue(cost());
    api.updateProjectCost.mockResolvedValue(cost({ taskId: null, taskTitle: null, revision: 5 }));
    renderModal({ mode: 'edit', costId: 'c1' });
    await screen.findByRole('option', { name: 'Tarea uno' });
    fireEvent.change(input('Tarea (opcional)'), { target: { value: '' } });
    submit();
    await waitFor(() => expect(api.updateProjectCost).toHaveBeenCalled());
    expect(api.updateProjectCost.mock.calls[0]![2]).toEqual({ expectedRevision: 4, taskId: null });
  });

  it('rubro histórico (fuera del presupuesto vigente): se muestra, no se reemplaza solo y se puede editar lo demás sin enviarlo', async () => {
    api.getProjectCost.mockResolvedValue(cost({ costCategoryId: 'cat-viejo', categoryName: 'Viáticos (retirado)' }));
    api.updateProjectCost.mockResolvedValue(cost({ revision: 5 }));
    renderModal({ mode: 'edit', costId: 'c1' });
    await screen.findByDisplayValue('Honorarios');
    expect(input('Rubro').value).toBe('cat-viejo');
    expect(screen.getByRole('option', { name: /Viáticos \(retirado\) — rubro actual del costo/ })).toBeTruthy();
    expect(screen.getByText(/ya no forma parte del presupuesto vigente/)).toBeTruthy();
    // las opciones para ELEGIR son solo las del presupuesto vigente
    const options = within(input('Rubro')).getAllByRole('option').map((o) => o.textContent);
    expect(options.filter((t) => !t!.includes('rubro actual'))).toEqual(['Elegí un rubro…', 'Recursos humanos', 'Licencias y software']);
    fireEvent.change(input('Descripción'), { target: { value: 'Corregido' } });
    submit();
    await waitFor(() => expect(api.updateProjectCost).toHaveBeenCalled());
    expect(api.updateProjectCost.mock.calls[0]![2]).toEqual({ expectedRevision: 4, description: 'Corregido' });
  });

  it('una tarea que ya no está en la lista (p. ej. archivada) se sigue mostrando con su título', async () => {
    api.getProjectCost.mockResolvedValue(cost({ taskId: 't-vieja', taskTitle: 'Tarea archivada' }));
    renderModal({ mode: 'edit', costId: 'c1' });
    await screen.findByRole('option', { name: 'Tarea archivada' });
    expect(input('Tarea (opcional)').value).toBe('t-vieja');
  });

  it('en edición, sin presupuesto vigente igual se puede corregir lo demás', async () => {
    api.getProjectBudget.mockRejectedValue(new ApiRequestError(404, 'Not Found', [], 'BUDGET_NOT_FOUND'));
    api.getProjectCost.mockResolvedValue(cost());
    renderModal({ mode: 'edit', costId: 'c1' });
    await screen.findByDisplayValue('Honorarios');
    expect(form()).toBeTruthy();
  });

  it('COST_NO_CHANGES: aviso suave (no error rojo) y el formulario sigue abierto', async () => {
    api.getProjectCost.mockResolvedValue(cost());
    api.updateProjectCost.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'COST_NO_CHANGES'));
    const { onClose } = renderModal({ mode: 'edit', costId: 'c1' });
    await screen.findByDisplayValue('Honorarios');
    submit();
    expect((await screen.findByRole('status')).textContent).toBe('No hay cambios para guardar.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(api.updateProjectCost.mock.calls[0]![2]).toEqual({ expectedRevision: 4 });
  });

  it('COST_VERSION_CONFLICT: aviso con Recargar/Cancelar; Recargar vuelve a pedir el detalle y reconstruye el formulario SIN reenviar el PATCH', async () => {
    api.getProjectCost.mockResolvedValueOnce(cost());
    api.updateProjectCost.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'COST_VERSION_CONFLICT', { currentRevision: 5 }));
    const { onClose } = renderModal({ mode: 'edit', costId: 'c1' });
    await screen.findByDisplayValue('Honorarios');
    fireEvent.change(input('Monto'), { target: { value: '12000' } });
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Este costo fue modificado por otro usuario mientras estabas editando.');
    expect(within(alert).getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(api.updateProjectCost).toHaveBeenCalledTimes(1);

    api.getProjectCost.mockResolvedValue(cost({ revision: 5, amount: '15000.00', description: 'Cambiado por otro' }));
    fireEvent.click(within(alert).getByRole('button', { name: 'Recargar' }));

    await screen.findByDisplayValue('Cambiado por otro');
    expect(input('Monto').value).toBe('15000.00'); // lo editado antes se descartó
    expect(api.getProjectCost).toHaveBeenCalledTimes(2);
    expect(api.updateProjectCost).toHaveBeenCalledTimes(1); // jamás se reenvió solo
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // y ahora el guardado usa la revisión NUEVA
    api.updateProjectCost.mockResolvedValue(cost({ revision: 6 }));
    fireEvent.change(input('Monto'), { target: { value: '16000' } });
    submit();
    await waitFor(() => expect(api.updateProjectCost).toHaveBeenCalledTimes(2));
    expect(api.updateProjectCost.mock.calls[1]![2]).toEqual({ expectedRevision: 5, amount: '16000.00' });
  });

  it('Cancelar en el conflicto cierra sin guardar', async () => {
    api.getProjectCost.mockResolvedValue(cost());
    api.updateProjectCost.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'COST_VERSION_CONFLICT'));
    const { onClose } = renderModal({ mode: 'edit', costId: 'c1' });
    await screen.findByDisplayValue('Honorarios');
    fireEvent.change(input('Monto'), { target: { value: '1' } });
    submit();
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.updateProjectCost).toHaveBeenCalledTimes(1);
  });

  it('costo inexistente al abrir (404): mensaje comprensible, sin stack, Cerrar, y se invalida la lista', async () => {
    api.getProjectCost.mockRejectedValue(new ApiRequestError(404, 'Not Found', [], 'COST_NOT_FOUND'));
    const { invalidate, onClose } = renderModal({ mode: 'edit', costId: 'c1' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Este costo ya no existe en el proyecto.');
    expect(alert.textContent).not.toContain('COST_NOT_FOUND');
    expect(form()).toBeNull();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project-costs', 'p1'] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' }).find((b) => b.textContent === 'Cerrar')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('403 al abrir la edición: mensaje de permisos, sin formulario', async () => {
    api.getProjectCost.mockRejectedValue(new ApiRequestError(403, 'Forbidden', []));
    renderModal({ mode: 'edit', costId: 'c1' });
    expect((await screen.findByRole('alert')).textContent).toContain('No tenés permisos para acceder a la información económica');
    expect(form()).toBeNull();
    expect(api.getProjectCost).toHaveBeenCalledTimes(1);
  });
});
