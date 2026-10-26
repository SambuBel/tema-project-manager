import { describe, expect, it } from 'vitest';
import type { Cost } from '@tema/shared-types';
import { changedCostFields, costFormFromCost, emptyCostForm, todayLocalIso, toCreateCostDto, toUpdateCostDto, validateCostForm, type CostFormState } from './costForm';

const cost: Cost = {
  id: 'c1', projectId: 'p1', taskId: 't1', taskTitle: 'Tarea uno', costCategoryId: 'cat-1', categoryName: 'Recursos humanos', amount: '10000.00', currency: 'ARS',
  costDate: '2026-10-20', description: 'Honorarios', createdBy: 'u1', createdByUser: { id: 'u1', name: 'Ana' }, createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z', revision: 4,
};
const valid: CostFormState = { costDate: '2026-10-25', amount: '1250,5', costCategoryId: 'cat-1', description: '  Licencias  ', taskId: '' };

describe('todayLocalIso / emptyCostForm', () => {
  it('usa la fecha LOCAL, no la UTC', () => {
    expect(todayLocalIso(new Date(2026, 9, 25, 23, 30))).toBe('2026-10-25');
    expect(todayLocalIso(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });
  it('alta: fecha de hoy y el resto vacío', () => {
    expect(emptyCostForm(new Date(2026, 9, 25))).toEqual({ costDate: '2026-10-25', amount: '', costCategoryId: '', description: '', taskId: '' });
  });
});

describe('validateCostForm', () => {
  it('formulario válido: sin errores (monto con coma, moneda en minúscula)', () => {
    expect(validateCostForm(valid).blocking).toEqual([]);
  });
  it.each([
    ['costDate', { costDate: '' }],
    ['costDate', { costDate: '2026-02-31' }],
    ['amount', { amount: '' }],
    ['amount', { amount: '-5' }],
    ['amount', { amount: '1e3' }],
    ['amount', { amount: '10.123' }],
    ['costCategoryId', { costCategoryId: '' }],
    ['description', { description: '   ' }],
    ['description', { description: 'x'.repeat(501) }],
  ] as const)('%s inválido', (field, patch) => {
    expect(validateCostForm({ ...valid, ...patch }).fieldErrors[field]).toBeTruthy();
  });
  it('NO bloquea fecha futura ni importes enormes (RN-19; fecha futura pendiente de TEMA)', () => {
    expect(validateCostForm({ ...valid, costDate: '2999-01-01', amount: '999999999999.99' }).blocking).toEqual([]);
  });
});

describe('toCreateCostDto', () => {
  it('monto como string canónico, moneda en mayúsculas, descripción recortada, sin taskId ni confirmación', () => {
    const dto = toCreateCostDto(valid);
    expect(dto).toEqual({ costDate: '2026-10-25', amount: '1250.50', costCategoryId: 'cat-1', description: 'Licencias' });
    expect('currency' in dto).toBe(false); // la moneda la deriva el backend desde el proyecto
    expect(typeof dto.amount).toBe('string');
    expect('taskId' in dto).toBe(false);
    expect('confirmBeforeProjectStart' in dto).toBe(false);
  });
  it('con tarea elegida envía taskId; la confirmación RN-21 solo cuando se pide', () => {
    expect(toCreateCostDto({ ...valid, taskId: 't9' }, true)).toMatchObject({ taskId: 't9', confirmBeforeProjectStart: true });
  });
});

describe('edición', () => {
  it('prellena desde el detalle actual', () => {
    expect(costFormFromCost(cost)).toEqual({ costDate: '2026-10-20', amount: '10000.00', costCategoryId: 'cat-1', description: 'Honorarios', taskId: 't1' });
    expect(costFormFromCost({ ...cost, taskId: null, taskTitle: null }).taskId).toBe('');
  });
  it('sin cambios: solo expectedRevision (el backend responderá COST_NO_CHANGES)', () => {
    const dto = toUpdateCostDto(costFormFromCost(cost), cost);
    expect(dto).toEqual({ expectedRevision: 4 });
    expect(changedCostFields(costFormFromCost(cost), cost)).toEqual([]);
  });
  it('"10000" y "10000,00" equivalen al "10000.00" original: no cuentan como cambio', () => {
    expect(changedCostFields({ ...costFormFromCost(cost), amount: '10000' }, cost)).toEqual([]);
    expect(changedCostFields({ ...costFormFromCost(cost), amount: '10000,00' }, cost)).toEqual([]);
  });
  it('patch parcial: solo lo que cambió', () => {
    const dto = toUpdateCostDto({ ...costFormFromCost(cost), amount: '12000', description: ' Nuevo ' }, cost);
    expect(dto).toEqual({ expectedRevision: 4, amount: '12000.00', description: 'Nuevo' });
  });
  it('cambiar de rubro y fecha (la moneda NO se edita: es la del proyecto)', () => {
    expect(toUpdateCostDto({ ...costFormFromCost(cost), costCategoryId: 'cat-2', costDate: '2026-09-01' }, cost)).toEqual({
      expectedRevision: 4, costCategoryId: 'cat-2', costDate: '2026-09-01',
    });
  });
  it('quitar la tarea envía taskId null; asignar otra, su id; conservar la omite', () => {
    expect(toUpdateCostDto({ ...costFormFromCost(cost), taskId: '' }, cost)).toEqual({ expectedRevision: 4, taskId: null });
    expect(toUpdateCostDto({ ...costFormFromCost(cost), taskId: 't2' }, cost)).toEqual({ expectedRevision: 4, taskId: 't2' });
    expect('taskId' in toUpdateCostDto({ ...costFormFromCost(cost), description: 'x' }, cost)).toBe(false);
  });
  it('un rubro histórico que NO se toca no viaja en el PATCH', () => {
    expect('costCategoryId' in toUpdateCostDto({ ...costFormFromCost(cost), description: 'Otro' }, cost)).toBe(false);
  });
  it('la confirmación RN-21 se agrega solo cuando se pide', () => {
    expect(toUpdateCostDto({ ...costFormFromCost(cost), costDate: '2020-01-01' }, cost, true).confirmBeforeProjectStart).toBe(true);
    expect('confirmBeforeProjectStart' in toUpdateCostDto({ ...costFormFromCost(cost), costDate: '2020-01-01' }, cost)).toBe(false);
  });
});
