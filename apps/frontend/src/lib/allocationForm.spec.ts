import { describe, expect, it } from 'vitest';
import type { MemberResourceAllocation } from '@tema/shared-types';
import { allocationFormFromMember, canonicalHours, expectedRevisionFor, toAllocationDto, validateAllocationForm } from './allocationForm';

const member = (allocation: MemberResourceAllocation['allocation']): MemberResourceAllocation => ({ projectMemberId: 'm1', user: { id: 'u1', name: 'Ana' }, allocation });
const senior = { id: 'rp-senior', name: 'Senior', hourlyCost: '50.00', currency: 'USD' };
const withAllocation = member({
  revision: 2, resourceProfile: senior, estimatedHours: '100.00', estimatedResourceCost: { amount: '5000.00', currency: 'USD' },
  budgetId: 'b1', budgetVersion: 2, createdAt: '2026-10-25T10:00:00.000Z', changedBy: { id: 'u9', name: 'Admin' },
});
const empty = member(null);

describe('canonicalHours', () => {
  it.each([['120', '120.00'], ['120,5', '120.50'], ['0', '0.00'], ['0.00', '0.00'], ['999999.99', '999999.99']])('%s → %s', (raw, expected) => expect(canonicalHours(raw)).toBe(expected));
  it.each(['', '-1', '1e2', '1.234', 'abc', '1234567'])('%j inválida (tope de 6 enteros)', (raw) => expect(canonicalHours(raw)).toBeNull());
});

describe('validateAllocationForm', () => {
  it('horas vacías o válidas: ok; 0 permitido', () => {
    expect(validateAllocationForm({ resourceProfileId: '', estimatedHours: '' }).blocking).toEqual([]);
    expect(validateAllocationForm({ resourceProfileId: '', estimatedHours: '0' }).blocking).toEqual([]);
  });
  it('horas inválidas bloquean', () => {
    expect(validateAllocationForm({ resourceProfileId: '', estimatedHours: '12abc' }).hoursError).toBeTruthy();
  });
});

describe('expectedRevisionFor / prellenado', () => {
  it('sin asignación → 0 (solo para el PATCH inicial); con asignación → la vigente', () => {
    expect(expectedRevisionFor(empty)).toBe(0);
    expect(expectedRevisionFor(withAllocation)).toBe(2);
  });
  it('prellena el perfil y las horas actuales', () => {
    expect(allocationFormFromMember(withAllocation)).toEqual({ resourceProfileId: 'rp-senior', estimatedHours: '100.00' });
    expect(allocationFormFromMember(empty)).toEqual({ resourceProfileId: '', estimatedHours: '' });
  });
});

describe('toAllocationDto - primera asignación (expectedRevision 0)', () => {
  it('solo perfil', () => expect(toAllocationDto({ resourceProfileId: 'rp-senior', estimatedHours: '' }, empty)).toEqual({ expectedRevision: 0, resourceProfileId: 'rp-senior' }));
  it('solo horas', () => expect(toAllocationDto({ resourceProfileId: '', estimatedHours: '100' }, empty)).toEqual({ expectedRevision: 0, estimatedHours: '100.00' }));
  it('ambos', () => expect(toAllocationDto({ resourceProfileId: 'rp-senior', estimatedHours: '100,5' }, empty)).toEqual({ expectedRevision: 0, resourceProfileId: 'rp-senior', estimatedHours: '100.50' }));
  it('nada: solo la revisión (el backend dirá NO_CHANGES); NO manda null por no haber tocado el campo', () => {
    expect(toAllocationDto({ resourceProfileId: '', estimatedHours: '' }, empty)).toEqual({ expectedRevision: 0 });
  });
});

describe('toAllocationDto - edición (omitido ≠ null)', () => {
  const base = { resourceProfileId: 'rp-senior', estimatedHours: '100.00' };
  it('solo horas: NO envía el perfil (no se refresca la tarifa)', () => {
    const dto = toAllocationDto({ ...base, estimatedHours: '120' }, withAllocation);
    expect(dto).toEqual({ expectedRevision: 2, estimatedHours: '120.00' });
    expect('resourceProfileId' in dto).toBe(false);
  });
  it('solo perfil: NO envía las horas', () => {
    expect(toAllocationDto({ ...base, resourceProfileId: 'rp-arch' }, withAllocation)).toEqual({ expectedRevision: 2, resourceProfileId: 'rp-arch' });
  });
  it('"Sin perfil" teniendo uno → resourceProfileId null', () => {
    expect(toAllocationDto({ ...base, resourceProfileId: '' }, withAllocation)).toEqual({ expectedRevision: 2, resourceProfileId: null });
  });
  it('horas vacías teniendo horas → estimatedHours null', () => {
    expect(toAllocationDto({ ...base, estimatedHours: '  ' }, withAllocation)).toEqual({ expectedRevision: 2, estimatedHours: null });
  });
  it('mismo perfil y mismas horas (aunque tipeadas distinto): solo la revisión', () => {
    expect(toAllocationDto(base, withAllocation)).toEqual({ expectedRevision: 2 });
    expect(toAllocationDto({ ...base, estimatedHours: '100' }, withAllocation)).toEqual({ expectedRevision: 2 });
  });
  it('quitar ambos', () => {
    expect(toAllocationDto({ resourceProfileId: '', estimatedHours: '' }, withAllocation)).toEqual({ expectedRevision: 2, resourceProfileId: null, estimatedHours: null });
  });
  it('sin perfil previo y sin tocarlo: no manda null', () => {
    const onlyHours = member({ ...withAllocation.allocation!, resourceProfile: null, estimatedResourceCost: null });
    expect(toAllocationDto({ resourceProfileId: '', estimatedHours: '130' }, onlyHours)).toEqual({ expectedRevision: 2, estimatedHours: '130.00' });
  });
});
