import { describe, expect, it } from 'vitest';
import type { RoleName, UserWithRoles } from '@tema/shared-types';
import { DEFAULT_USER_FILTERS, ROLE_FILTER_OPTIONS, clearFilters, filterAndSortUsers, hasActiveFilters, type UserFilters } from './userFilters';

const user = (name: string, email: string, active: boolean, roles: RoleName[], createdAt: string): UserWithRoles =>
  ({ id: name, name, email, avatarUrl: null, active, roles, createdAt }) as UserWithRoles;

const ANA = user('Ana Gómez', 'ana@tema.com', true, ['COLLABORATOR', 'OBSERVER'], '2026-03-01T00:00:00Z'); // multirrol
const BEL = user('Bel Sambu', 'bel.sambu@gmail.com', true, ['OBSERVER'], '2026-05-01T00:00:00Z');
const BELEN = user('Belén Ortiz', 'belen@tema.com', false, ['COLLABORATOR', 'OBSERVER'], '2026-02-01T00:00:00Z'); // inactivo
const CARLOS = user('Carlos Ruiz', 'carlos@tema.com', false, ['ADMIN'], '2026-01-01T00:00:00Z'); // inactivo
const DIANA = user('Diana Paz', 'diana@tema.com', true, ['PROJECT_LEADER'], '2026-04-01T00:00:00Z');
const ALL = [DIANA, CARLOS, BEL, ANA, BELEN]; // desordenado a propósito

const names = (users: UserWithRoles[]) => users.map((u) => u.name);
const run = (overrides: Partial<UserFilters>) => filterAndSortUsers(ALL, { ...DEFAULT_USER_FILTERS, ...overrides });

describe('defaults', () => {
  it('Estado = Todos, Rol = Todos, Orden = Nombre A-Z, sin búsqueda', () => {
    expect(DEFAULT_USER_FILTERS).toEqual({ search: '', status: 'ALL', role: 'ALL', sort: 'NAME_ASC' });
    expect(names(run({}))).toEqual(['Ana Gómez', 'Bel Sambu', 'Belén Ortiz', 'Carlos Ruiz', 'Diana Paz']);
  });
});

describe('1 y 2) búsqueda por nombre y por email (sin distinguir mayúsculas)', () => {
  it('por nombre', () => {
    expect(names(run({ search: 'diana' }))).toEqual(['Diana Paz']);
    expect(names(run({ search: 'GÓMEZ' }))).toEqual(['Ana Gómez']);
  });

  it('por email', () => {
    expect(names(run({ search: 'sambu@gmail' }))).toEqual(['Bel Sambu']);
    expect(names(run({ search: 'CARLOS@TEMA.COM' }))).toEqual(['Carlos Ruiz']);
  });

  it('coincidencia parcial en cualquiera de los dos campos; ignora espacios de los bordes', () => {
    expect(names(run({ search: '  tema.com ' }))).toEqual(['Ana Gómez', 'Belén Ortiz', 'Carlos Ruiz', 'Diana Paz']);
  });

  it('sin coincidencias → lista vacía', () => {
    expect(run({ search: 'zzz' })).toEqual([]);
  });
});

describe('3 y 4) estado: usa el campo real `active`', () => {
  it('Activos', () => {
    expect(names(run({ status: 'ACTIVE' }))).toEqual(['Ana Gómez', 'Bel Sambu', 'Diana Paz']);
  });

  it('Inactivos', () => {
    expect(names(run({ status: 'INACTIVE' }))).toEqual(['Belén Ortiz', 'Carlos Ruiz']);
  });

  it('no se infiere del rol: un ADMIN inactivo es inactivo', () => {
    expect(run({ status: 'ACTIVE', role: 'ADMIN' })).toEqual([]);
  });
});

describe('5, 6 y 7) rol: revisa user.roles COMPLETO', () => {
  it('ADMIN', () => {
    expect(names(run({ role: 'ADMIN' }))).toEqual(['Carlos Ruiz']);
  });

  it('PROJECT_LEADER', () => {
    expect(names(run({ role: 'PROJECT_LEADER' }))).toEqual(['Diana Paz']);
  });

  it('multirrol [COLLABORATOR, OBSERVER]: aparece al filtrar por Colaborador Y por Observador', () => {
    expect(names(run({ role: 'COLLABORATOR' }))).toContain('Ana Gómez');
    expect(names(run({ role: 'OBSERVER' }))).toContain('Ana Gómez');
    expect(names(run({ role: 'OBSERVER' }))).toEqual(['Ana Gómez', 'Bel Sambu', 'Belén Ortiz']);
  });

  it('un rol que nadie tiene → vacío; PROGRAM_MANAGER no coincide con otros roles', () => {
    expect(run({ role: 'PROGRAM_MANAGER' })).toEqual([]);
  });

  it('las opciones de rol son los 5 reales más "Todos", en español', () => {
    expect(ROLE_FILTER_OPTIONS.map((o) => o.label)).toEqual(['Todos', 'Administrador', 'Program Manager', 'Líder de proyecto', 'Colaborador', 'Observador']);
  });
});

describe('8) combinación búsqueda + estado + rol (AND)', () => {
  it('buscar "bel" + Activos + Observador → solo Bel Sambu (Belén es inactiva)', () => {
    expect(names(run({ search: 'bel', status: 'ACTIVE', role: 'OBSERVER' }))).toEqual(['Bel Sambu']);
  });

  it('cambiando solo el estado a Inactivos → Belén Ortiz', () => {
    expect(names(run({ search: 'bel', status: 'INACTIVE', role: 'OBSERVER' }))).toEqual(['Belén Ortiz']);
  });

  it('si UNA condición no se cumple, no aparece', () => {
    expect(run({ search: 'bel', status: 'ACTIVE', role: 'ADMIN' })).toEqual([]);
  });
});

describe('9) limpiar filtros', () => {
  it('hasActiveFilters: solo búsqueda, estado o rol cuentan; el orden NO', () => {
    expect(hasActiveFilters(DEFAULT_USER_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_USER_FILTERS, sort: 'NAME_DESC' })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_USER_FILTERS, search: '  ' })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_USER_FILTERS, search: 'a' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_USER_FILTERS, status: 'ACTIVE' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_USER_FILTERS, role: 'ADMIN' })).toBe(true);
  });

  it('clearFilters vuelve búsqueda/estado/rol al default y conserva el orden elegido', () => {
    const cleared = clearFilters({ search: 'bel', status: 'ACTIVE', role: 'OBSERVER', sort: 'NAME_DESC' });
    expect(cleared).toEqual({ ...DEFAULT_USER_FILTERS, sort: 'NAME_DESC' });
    expect(names(filterAndSortUsers(ALL, cleared))).toHaveLength(5);
  });
});

describe('11 y 12) orden', () => {
  it('Nombre A-Z (ignora mayúsculas y tildes: "Belén" va junto a "Bel")', () => {
    expect(names(run({ sort: 'NAME_ASC' }))).toEqual(['Ana Gómez', 'Bel Sambu', 'Belén Ortiz', 'Carlos Ruiz', 'Diana Paz']);
  });

  it('Nombre Z-A', () => {
    expect(names(run({ sort: 'NAME_DESC' }))).toEqual(['Diana Paz', 'Carlos Ruiz', 'Belén Ortiz', 'Bel Sambu', 'Ana Gómez']);
  });

  it('Más recientes (createdAt descendente)', () => {
    expect(names(run({ sort: 'NEWEST' }))).toEqual(['Bel Sambu', 'Diana Paz', 'Ana Gómez', 'Belén Ortiz', 'Carlos Ruiz']);
  });

  it('el orden se aplica sobre el resultado filtrado', () => {
    expect(names(run({ status: 'ACTIVE', sort: 'NAME_DESC' }))).toEqual(['Diana Paz', 'Bel Sambu', 'Ana Gómez']);
  });

  it('no muta la lista original', () => {
    const copy = [...ALL];
    run({ sort: 'NAME_DESC' });
    expect(ALL).toEqual(copy);
  });

  it('createdAt inválido no rompe el orden', () => {
    const broken = { ...BEL, createdAt: 'basura' } as UserWithRoles;
    expect(() => filterAndSortUsers([broken, ANA], { ...DEFAULT_USER_FILTERS, sort: 'NEWEST' })).not.toThrow();
  });
});
