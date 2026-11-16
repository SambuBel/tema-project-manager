import { describe, expect, it } from 'vitest';
import type { RoleName } from '@tema/shared-types';
import { getPrimaryRole, hasAnyRole, roleLabels } from './roles';
import { rolePermissionsInfo } from './rolePermissionsInfo';
import { DEFAULT_PROJECT_CURRENCY, PROJECT_CURRENCY_OPTIONS, currencyOptionLabel } from './currencies';

const ALL_ROLES: RoleName[] = ['ADMIN', 'PROGRAM_MANAGER', 'PROJECT_LEADER', 'COLLABORATOR', 'OBSERVER'];

describe('getPrimaryRole', () => {
  it('sin roles devuelve null', () => {
    expect(getPrimaryRole([])).toBeNull();
  });

  it('con un solo rol devuelve ese rol', () => {
    expect(getPrimaryRole(['OBSERVER'])).toBe('OBSERVER');
  });

  it('prioriza ADMIN por sobre cualquier otro rol', () => {
    expect(getPrimaryRole(['OBSERVER', 'COLLABORATOR', 'ADMIN'])).toBe('ADMIN');
  });

  it('respeta la jerarquía sin importar el orden de entrada', () => {
    expect(getPrimaryRole(['COLLABORATOR', 'PROJECT_LEADER'])).toBe('PROJECT_LEADER');
    expect(getPrimaryRole(['PROJECT_LEADER', 'PROGRAM_MANAGER'])).toBe('PROGRAM_MANAGER');
  });
});

describe('hasAnyRole', () => {
  it('es true si el usuario tiene alguno de los roles permitidos', () => {
    expect(hasAnyRole(['COLLABORATOR'], ['ADMIN', 'COLLABORATOR'])).toBe(true);
  });

  it('es false si no coincide ninguno o la lista de permitidos está vacía', () => {
    expect(hasAnyRole(['OBSERVER'], ['ADMIN', 'PROGRAM_MANAGER'])).toBe(false);
    expect(hasAnyRole(['ADMIN'], [])).toBe(false);
  });
});

describe('roleLabels y rolePermissionsInfo', () => {
  it('todos los roles tienen una etiqueta en español', () => {
    for (const role of ALL_ROLES) expect(roleLabels[role].length).toBeGreaterThan(0);
  });

  it('todos los roles tienen descripción y lista de permisos', () => {
    for (const role of ALL_ROLES) {
      expect(rolePermissionsInfo[role].description.length).toBeGreaterThan(0);
      expect(rolePermissionsInfo[role].can.length).toBeGreaterThan(0);
    }
  });

  it('ADMIN y PROGRAM_MANAGER no tienen restricciones; OBSERVER sí', () => {
    expect(rolePermissionsInfo.ADMIN.cannot).toEqual([]);
    expect(rolePermissionsInfo.PROGRAM_MANAGER.cannot).toEqual([]);
    expect(rolePermissionsInfo.OBSERVER.cannot.length).toBeGreaterThan(0);
  });
});

describe('currencies', () => {
  it('ofrece solo ARS y USD, y la moneda por defecto es una de ellas', () => {
    expect(PROJECT_CURRENCY_OPTIONS.map((c) => c.code)).toEqual(['ARS', 'USD']);
    expect(PROJECT_CURRENCY_OPTIONS.map((c) => c.code)).toContain(DEFAULT_PROJECT_CURRENCY);
  });

  it('currencyOptionLabel arma "CÓDIGO — Nombre"', () => {
    expect(currencyOptionLabel({ code: 'USD', name: 'Dólar estadounidense' })).toBe('USD — Dólar estadounidense');
  });
});
