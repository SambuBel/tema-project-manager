import { describe, expect, it } from 'vitest';
import type { Budget, CostCategory } from '@tema/shared-types';
import {
  budgetFormFromCurrent,
  duplicatedCategoryIds,
  emptyBudgetForm,
  inactiveCategoryKeys,
  summarizeSum,
  toCreateDto,
  toVersionDto,
  validateBudgetForm,
  type BudgetFormState,
} from './budgetForm';

const RRHH: CostCategory = { id: 'c-rrhh', name: 'Recursos humanos' };
const SOFT: CostCategory = { id: 'c-soft', name: 'Licencias y software' };
const ACTIVE = [RRHH, SOFT];

const state = (over: Partial<BudgetFormState> = {}): BudgetFormState => ({
  totalAmount: '1000000',
  currency: 'ars',
  approvalDate: '2026-10-25',
  items: [
    { key: 'a', costCategoryId: RRHH.id, amount: '600000' },
    { key: 'b', costCategoryId: SOFT.id, amount: '400000' },
  ],
  ...over,
});

const current: Budget = {
  id: 'b3', projectId: 'p1', version: 3, totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-25', isCurrent: true, supersededAt: null,
  createdBy: 'u1', createdAt: '2026-10-25T10:00:00Z',
  items: [
    { costCategoryId: RRHH.id, categoryName: 'Recursos humanos', amount: '600000.00' },
    { costCategoryId: 'c-viejo', categoryName: 'Licencias (retirado)', amount: '400000.00' },
  ],
};

describe('summarizeSum (suma exacta contra el total)', () => {
  it('coincide', () => {
    expect(summarizeSum(state())).toEqual({ itemsTotal: '1000000.00', status: { kind: 'match' } });
  });
  it('0.10 + 0.20 contra 0.30 coincide (sin error de punto flotante)', () => {
    const s = state({ totalAmount: '0.30', items: [{ key: 'a', costCategoryId: RRHH.id, amount: '0.10' }, { key: 'b', costCategoryId: SOFT.id, amount: '0,20' }] });
    expect(summarizeSum(s).status.kind).toBe('match');
  });
  it('faltan: informa la diferencia exacta', () => {
    const s = state({ items: [{ key: 'a', costCategoryId: RRHH.id, amount: '600000' }, { key: 'b', costCategoryId: SOFT.id, amount: '350000' }] });
    expect(summarizeSum(s)).toEqual({ itemsTotal: '950000.00', status: { kind: 'missing', difference: '50000.00' } });
  });
  it('se pasan: informa el exceso exacto', () => {
    const s = state({ items: [{ key: 'a', costCategoryId: RRHH.id, amount: '600000.01' }, { key: 'b', costCategoryId: SOFT.id, amount: '400000' }] });
    expect(summarizeSum(s).status).toEqual({ kind: 'excess', difference: '0.01' });
  });
  it('incompleto si el total o algún importe está vacío o inválido (no se asume 0)', () => {
    expect(summarizeSum(state({ totalAmount: '' })).status.kind).toBe('incomplete');
    expect(summarizeSum(state({ items: [{ key: 'a', costCategoryId: RRHH.id, amount: '' }] })).status.kind).toBe('incomplete');
    expect(summarizeSum(state({ items: [{ key: 'a', costCategoryId: RRHH.id, amount: 'x' }] })).status.kind).toBe('incomplete');
  });
  it('importes enormes siguen siendo exactos', () => {
    const s = state({ totalAmount: '999999999999.99', items: [{ key: 'a', costCategoryId: RRHH.id, amount: '999999999999.98' }, { key: 'b', costCategoryId: SOFT.id, amount: '0.01' }] });
    expect(summarizeSum(s).status.kind).toBe('match');
  });
});

describe('validateBudgetForm', () => {
  it('formulario correcto: nada bloquea', () => {
    expect(validateBudgetForm(state(), ACTIVE).blocking).toEqual([]);
  });
  it('formulario vacío: pide los datos que faltan', () => {
    const issues = validateBudgetForm(emptyBudgetForm('ARS'), ACTIVE);
    expect(issues.blocking.join(' ')).toMatch(/total/i);
    expect(issues.blocking.join(' ')).not.toMatch(/moneda/i); // la moneda no se pide: es la del proyecto
    expect(issues.blocking.join(' ')).toMatch(/fecha/i);
  });
  it('sin partidas no se puede guardar', () => {
    expect(validateBudgetForm(state({ items: [] }), ACTIVE).blocking).toContain('Agregá al menos una partida.');
  });
  it('suma distinta del total bloquea', () => {
    const issues = validateBudgetForm(state({ totalAmount: '999999' }), ACTIVE);
    expect(issues.blocking).toContain('La suma de las partidas debe coincidir con el total.');
  });
  it('rubros repetidos: cada fila repetida se marca (UX; el backend vuelve a validar)', () => {
    const s = state({ items: [{ key: 'a', costCategoryId: RRHH.id, amount: '500000' }, { key: 'b', costCategoryId: RRHH.id, amount: '500000' }] });
    expect(duplicatedCategoryIds(s)).toEqual(new Set([RRHH.id]));
    const issues = validateBudgetForm(s, ACTIVE);
    expect(issues.itemErrors.a).toMatch(/otra partida/);
    expect(issues.itemErrors.b).toMatch(/otra partida/);
  });
  it('la moneda no se valida ni se pide: es la ÚNICA del proyecto', () => {
    expect('currency' in validateBudgetForm(state({ currency: '' }), ACTIVE).fieldErrors).toBe(false);
    expect(validateBudgetForm(state({ currency: '' }), ACTIVE).blocking).toEqual([]);
  });
  it('fecha de calendario real', () => {
    expect(validateBudgetForm(state({ approvalDate: '2026-02-31' }), ACTIVE).fieldErrors.approvalDate).toBeDefined();
    expect(validateBudgetForm(state({ approvalDate: '' }), ACTIVE).fieldErrors.approvalDate).toBeDefined();
  });
  it('mientras el catálogo no cargó (null) no se marca ningún rubro como inactivo', () => {
    const s = budgetFormFromCurrent(current);
    expect(inactiveCategoryKeys(s, null).size).toBe(0);
    expect(validateBudgetForm(s, null).blocking.join(' ')).not.toMatch(/inactivo/);
  });
  it('una partida prellenada con un rubro que ya no está activo bloquea y NO se reemplaza ni se borra sola', () => {
    const s = budgetFormFromCurrent(current);
    expect(inactiveCategoryKeys(s, ACTIVE).size).toBe(1);
    const issues = validateBudgetForm(s, ACTIVE);
    expect(issues.blocking).toContain('Reemplazá o eliminá las partidas con rubro inactivo.');
    const inactiveRow = s.items.find((i) => i.costCategoryId === 'c-viejo')!;
    expect(issues.itemErrors[inactiveRow.key]).toMatch(/inactivo/);
    // el estado conserva el nombre histórico y el importe tal cual
    expect(inactiveRow).toMatchObject({ categoryName: 'Licencias (retirado)', amount: '400000.00', costCategoryId: 'c-viejo' });
  });
});

describe('requests (todo importe como texto canónico, nunca Number)', () => {
  it('creación: normaliza importes y NO envía moneda (la deriva el backend desde el proyecto)', () => {
    expect(toCreateDto(state({ totalAmount: '1000000,5', items: [{ key: 'a', costCategoryId: RRHH.id, amount: '1000000,5' }] }))).toEqual({
      totalAmount: '1000000.50',
      approvalDate: '2026-10-25',
      items: [{ costCategoryId: RRHH.id, amount: '1000000.50' }],
    });
  });
  it('la fila se manda por costCategoryId (no por nombre) y sin campos locales', () => {
    const dto = toCreateDto(budgetFormFromCurrent(current));
    expect(dto.items).toEqual([{ costCategoryId: RRHH.id, amount: '600000.00' }, { costCategoryId: 'c-viejo', amount: '400000.00' }]);
    expect(JSON.stringify(dto)).not.toMatch(/categoryName|key/);
  });
  it('nueva versión: agrega expectedVersion (la versión vigente que el usuario tenía)', () => {
    expect(toVersionDto(state(), 3).expectedVersion).toBe(3);
    expect(typeof toVersionDto(state(), 3).totalAmount).toBe('string');
  });
});

describe('prellenado de la nueva versión', () => {
  it('copia total, moneda, fecha y partidas del vigente', () => {
    const s = budgetFormFromCurrent(current);
    expect(s).toMatchObject({ totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-25' });
    expect(s.items).toHaveLength(2);
  });
  it('la nueva versión conserva la moneda del vigente (que es la del proyecto) y no hay forma de cambiarla', () => {
    expect(budgetFormFromCurrent(current).currency).toBe('ARS');
    expect('currency' in toVersionDto(budgetFormFromCurrent(current), 3)).toBe(false);
  });
  it('la creación nace con la moneda del proyecto (solo para mostrarla)', () => {
    expect(emptyBudgetForm('USD').currency).toBe('USD');
  });
});
