// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, RoleName, UserWithRoles } from '@tema/shared-types';
import { api } from '../lib/api';
import { AdminUsersPage } from './AdminUsersPage';

const user = (name: string, email: string, active: boolean, roles: RoleName[], createdAt: string): UserWithRoles =>
  ({ id: name, name, email, avatarUrl: null, active, roles, createdAt }) as UserWithRoles;

const USERS = [
  user('Diana Paz', 'diana@tema.com', true, ['PROJECT_LEADER'], '2026-04-01T00:00:00Z'),
  user('Carlos Ruiz', 'carlos@tema.com', false, ['ADMIN'], '2026-01-01T00:00:00Z'),
  user('Bel Sambu', 'bel.sambu@gmail.com', true, ['OBSERVER'], '2026-05-01T00:00:00Z'),
  user('Ana Gómez', 'ana@tema.com', true, ['COLLABORATOR', 'OBSERVER'], '2026-03-01T00:00:00Z'),
  user('Belén Ortiz', 'belen@tema.com', false, ['COLLABORATOR', 'OBSERVER'], '2026-02-01T00:00:00Z'),
];
const admin: AuthenticatedUser = { id: 'me', email: 'me@tema.com', name: 'Yo', avatarUrl: null, roles: ['ADMIN'] };

async function renderPage() {
  const listUsers = vi.spyOn(api, 'listUsers').mockResolvedValue(USERS);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth', 'me'], admin);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findAllByText('Diana Paz');
  return listUsers;
}

/** Nombres en el orden en que aparecen en la TABLA (la vista desktop; las tarjetas mobile repiten los datos). */
const tableNames = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]!.querySelector('.font-medium')!.textContent); // sin las iniciales del avatar

const search = () => screen.getByLabelText('Buscar usuario') as HTMLInputElement;
const estado = () => screen.getByLabelText('Estado:') as HTMLSelectElement;
const rol = () => screen.getByLabelText('Rol:') as HTMLSelectElement;
const orden = () => screen.getByLabelText('Ordenar:') as HTMLSelectElement;
const clearButton = () => screen.queryByRole('button', { name: 'Limpiar filtros' });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AdminUsersPage - controles', () => {
  it('muestra buscador, Estado, Rol y Ordenar con sus defaults', async () => {
    await renderPage();
    expect(search().value).toBe('');
    expect(estado().value).toBe('ALL');
    expect(rol().value).toBe('ALL');
    expect(orden().value).toBe('NAME_ASC');
    expect(Array.from(estado().options).map((o) => o.text)).toEqual(['Todos', 'Activos', 'Inactivos']);
    expect(Array.from(rol().options).map((o) => o.text)).toEqual(['Todos', 'Administrador', 'Program Manager', 'Líder de proyecto', 'Colaborador', 'Observador']);
    expect(Array.from(orden().options).map((o) => o.text)).toEqual(['Nombre A-Z', 'Nombre Z-A', 'Más recientes']);
  });

  it('por defecto lista a TODOS (activos e inactivos), de la A a la Z', async () => {
    await renderPage();
    expect(tableNames()).toEqual(['Ana Gómez', 'Bel Sambu', 'Belén Ortiz', 'Carlos Ruiz', 'Diana Paz']);
  });

  it('pide el listado completo UNA vez, con los desactivados incluidos', async () => {
    const listUsers = await renderPage();
    expect(listUsers).toHaveBeenCalledTimes(1);
    expect(listUsers).toHaveBeenCalledWith({ includeInactive: true });
  });

  it('los controles se apilan en mobile y se alinean en fila desde sm (clases responsive)', async () => {
    await renderPage();
    const row = search().parentElement!;
    expect(row.className).toContain('flex-col');
    expect(row.className).toContain('sm:flex-row');
  });
});

describe('AdminUsersPage - filtros (en memoria, sin nuevos requests)', () => {
  it('búsqueda por nombre y por email, sin distinguir mayúsculas', async () => {
    const listUsers = await renderPage();
    type(search(), 'DIANA');
    expect(tableNames()).toEqual(['Diana Paz']);
    type(search(), 'sambu@GMAIL');
    expect(tableNames()).toEqual(['Bel Sambu']);
    expect(listUsers).toHaveBeenCalledTimes(1); // buscar no dispara requests
  });

  it('Activos / Inactivos', async () => {
    await renderPage();
    type(estado(), 'ACTIVE');
    expect(tableNames()).toEqual(['Ana Gómez', 'Bel Sambu', 'Diana Paz']);
    type(estado(), 'INACTIVE');
    expect(tableNames()).toEqual(['Belén Ortiz', 'Carlos Ruiz']);
  });

  it('rol ADMIN y rol Líder de proyecto', async () => {
    await renderPage();
    type(rol(), 'ADMIN');
    expect(tableNames()).toEqual(['Carlos Ruiz']);
    type(rol(), 'PROJECT_LEADER');
    expect(tableNames()).toEqual(['Diana Paz']);
  });

  it('usuario multirrol [Colaborador, Observador] aparece en ambos filtros', async () => {
    await renderPage();
    type(rol(), 'COLLABORATOR');
    expect(tableNames()).toContain('Ana Gómez');
    type(rol(), 'OBSERVER');
    expect(tableNames()).toContain('Ana Gómez');
  });

  it('combinación: "bel" + Activos + Observador → solo Bel Sambu', async () => {
    await renderPage();
    type(search(), 'bel');
    type(estado(), 'ACTIVE');
    type(rol(), 'OBSERVER');
    expect(tableNames()).toEqual(['Bel Sambu']);
  });
});

describe('AdminUsersPage - orden', () => {
  it('Nombre A-Z y Nombre Z-A', async () => {
    await renderPage();
    type(orden(), 'NAME_DESC');
    expect(tableNames()).toEqual(['Diana Paz', 'Carlos Ruiz', 'Belén Ortiz', 'Bel Sambu', 'Ana Gómez']);
    type(orden(), 'NAME_ASC');
    expect(tableNames()).toEqual(['Ana Gómez', 'Bel Sambu', 'Belén Ortiz', 'Carlos Ruiz', 'Diana Paz']);
  });

  it('Más recientes', async () => {
    await renderPage();
    type(orden(), 'NEWEST');
    expect(tableNames()).toEqual(['Bel Sambu', 'Diana Paz', 'Ana Gómez', 'Belén Ortiz', 'Carlos Ruiz']);
  });
});

describe('AdminUsersPage - limpiar filtros y vacío', () => {
  it('"Limpiar filtros" NO aparece con los valores por defecto (ni cambiando solo el orden)', async () => {
    await renderPage();
    expect(clearButton()).toBeNull();
    type(orden(), 'NAME_DESC');
    expect(clearButton()).toBeNull();
  });

  it('aparece con cualquier filtro activo y lo deja todo en default (conservando el orden elegido)', async () => {
    await renderPage();
    type(orden(), 'NAME_DESC');
    type(search(), 'bel');
    type(estado(), 'ACTIVE');
    type(rol(), 'OBSERVER');
    expect(clearButton()).not.toBeNull();

    fireEvent.click(clearButton()!);

    expect(search().value).toBe('');
    expect(estado().value).toBe('ALL');
    expect(rol().value).toBe('ALL');
    expect(orden().value).toBe('NAME_DESC');
    expect(tableNames()).toHaveLength(5);
    expect(clearButton()).toBeNull();
  });

  it('sin coincidencias: "No se encontraron usuarios con los filtros seleccionados."', async () => {
    await renderPage();
    type(search(), 'nadie-se-llama-asi');
    expect(screen.getByText('No se encontraron usuarios con los filtros seleccionados.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(clearButton()).not.toBeNull(); // desde ahí se sale del vacío
  });

  it('abrir el drawer de un usuario no se pierde al filtrar', async () => {
    await renderPage();
    fireEvent.click(within(screen.getByRole('table')).getByText('Diana Paz'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    type(search(), 'carlos'); // Diana ya no está en la lista filtrada
    expect(screen.getByRole('dialog').textContent).toContain('Diana Paz');
  });

  it('sin usuarios en el sistema sigue mostrando "No hay usuarios todavía."', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], admin);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminUsersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('No hay usuarios todavía.')).toBeTruthy();
  });
});
