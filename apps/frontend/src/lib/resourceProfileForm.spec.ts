import { describe, expect, it } from 'vitest';
import type { ResourceProfile } from '@tema/shared-types';
import { canonicalHourlyCost, changedProfileFields, emptyProfileForm, profileFormFromProfile, toActiveToggleDto, toCreateProfileDto, toUpdateProfileDto, validateProfileForm } from './resourceProfileForm';

const profile: ResourceProfile = { id: 'r1', name: 'Senior', hourlyCost: '50.00', currency: 'USD', active: true, revision: 3, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z' };
const valid = { name: '  Senior Dev  ', hourlyCost: '40000,5', currency: 'ars', active: true };

describe('canonicalHourlyCost', () => {
  it.each([['50', '50.00'], ['50.5', '50.50'], ['40000,50', '40000.50'], ['0', '0.00'], ['0.00', '0.00'], ['9999999999.99', '9999999999.99']])('%s → %s', (raw, expected) => {
    expect(canonicalHourlyCost(raw)).toBe(expected);
  });
  it.each(['', '-1', '1e3', '10.123', 'abc', '12345678901', '1.000,00'])('%j es inválida', (raw) => {
    expect(canonicalHourlyCost(raw)).toBeNull(); // 11 enteros: el tope de la tarifa es 10
  });
});

describe('validateProfileForm', () => {
  it('válido; 0 está permitido', () => {
    expect(validateProfileForm(valid).blocking).toEqual([]);
    expect(validateProfileForm({ ...valid, hourlyCost: '0' }).blocking).toEqual([]);
  });
  it.each([
    ['name', { name: '   ' }],
    ['name', { name: 'x'.repeat(151) }],
    ['hourlyCost', { hourlyCost: '' }],
    ['hourlyCost', { hourlyCost: '-5' }],
    ['hourlyCost', { hourlyCost: '1.234' }],
    ['currency', { currency: 'US' }],
    ['currency', { currency: '1SD' }],
  ] as const)('%s inválido', (field, patch) => {
    expect(validateProfileForm({ ...valid, ...patch }).fieldErrors[field]).toBeTruthy();
  });
  it('el nombre de 150 caracteres es válido', () => {
    expect(validateProfileForm({ ...valid, name: 'x'.repeat(150) }).blocking).toEqual([]);
  });
  it('no valida unicidad: "Senior" en USD y en ARS son válidos (eso lo decide el backend)', () => {
    expect(validateProfileForm({ ...valid, name: 'Senior', currency: 'USD' }).blocking).toEqual([]);
    expect(validateProfileForm({ ...valid, name: 'Senior', currency: 'ARS' }).blocking).toEqual([]);
  });
});

describe('toCreateProfileDto', () => {
  it('nombre recortado SIN cambiar mayúsculas; tarifa string canónica; moneda en mayúsculas; sin active', () => {
    const dto = toCreateProfileDto(valid);
    expect(dto).toEqual({ name: 'Senior Dev', hourlyCost: '40000.50', currency: 'ARS' });
    expect(typeof dto.hourlyCost).toBe('string');
    expect('active' in dto).toBe(false);
    expect(toCreateProfileDto({ ...valid, name: 'senior' }).name).toBe('senior');
  });
  it('tarifa 0 se envía como "0.00"', () => {
    expect(toCreateProfileDto({ ...valid, hourlyCost: '0' }).hourlyCost).toBe('0.00');
  });
});

describe('edición', () => {
  it('prellena name, tarifa, moneda y active', () => {
    expect(profileFormFromProfile(profile)).toEqual({ name: 'Senior', hourlyCost: '50.00', currency: 'USD', active: true });
    expect(emptyProfileForm()).toEqual({ name: '', hourlyCost: '', currency: '', active: true });
  });
  it('sin cambios: solo expectedRevision', () => {
    expect(toUpdateProfileDto(profileFormFromProfile(profile), profile)).toEqual({ expectedRevision: 3 });
    expect(changedProfileFields({ ...profileFormFromProfile(profile), hourlyCost: '50' }, profile)).toEqual([]);
  });
  it('solo lo que cambió', () => {
    expect(toUpdateProfileDto({ ...profileFormFromProfile(profile), hourlyCost: '60' }, profile)).toEqual({ expectedRevision: 3, hourlyCost: '60.00' });
    expect(toUpdateProfileDto({ ...profileFormFromProfile(profile), name: ' Lead ', currency: 'ars', active: false }, profile)).toEqual({
      expectedRevision: 3, name: 'Lead', currency: 'ARS', active: false,
    });
  });
  it('activar / desactivar desde la fila: solo active + revisión', () => {
    expect(toActiveToggleDto(profile, false)).toEqual({ expectedRevision: 3, active: false });
    expect(toActiveToggleDto({ ...profile, active: false, revision: 7 }, true)).toEqual({ expectedRevision: 7, active: true });
  });
});
