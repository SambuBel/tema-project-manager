// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, RoleName, UserWithRoles } from '@tema/shared-types';
import { api, ApiRequestError } from '../lib/api';
import { canCreateUsersUI } from '../lib/permissions';
import { AdminUsersPage } from './AdminUsersPage';

const me = (roles: RoleName[]): AuthenticatedUser => ({ id: 'me', email: 'me@tema.com', name: 'Yo Mismo', avatarUrl: null, roles });
const existing = { id: 'u1', email: 'ana@tema.com', name: 'Ana Gómez', avatarUrl: null, active: true, roles: ['COLLABORATOR'] } as unknown as UserWithRoles;
const created = { id: 'u2', email: 'juan@tema.com', name: 'Juan Pérez', avatarUrl: null, active: true, roles: ['PROJECT_LEADER'] } as unknown as UserWithRoles;

function renderPage(currentUser: AuthenticatedUser) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['auth', 'me'], currentUser);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

const newUserButton = () => screen.queryByRole('button', { name: '+ Nuevo usuario' });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AdminUsersPage - botón "+ Nuevo usuario" según el rol', () => {
  it('ADMIN lo ve, en el encabezado junto al título "Usuarios y permisos"', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([existing]);
    renderPage(me(['ADMIN']));

    expect(newUserButton()).toBeTruthy();
    const header = screen.getByRole('heading', { name: 'Usuarios y permisos' }).closest('div')!.parentElement!;
    expect(header.contains(newUserButton())).toBe(true);
    await screen.findAllByText('Ana Gómez');
  });

  it.each([
    ['PROGRAM_MANAGER', ['PROGRAM_MANAGER'] as RoleName[]],
    ['PROJECT_LEADER', ['PROJECT_LEADER'] as RoleName[]],
    ['COLLABORATOR', ['COLLABORATOR'] as RoleName[]],
    ['OBSERVER', ['OBSERVER'] as RoleName[]],
  ])('%s NO lo ve (y la pantalla sigue funcionando)', async (_label, roles) => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([existing]);
    renderPage(me(roles));

    await screen.findAllByText('Ana Gómez');
    expect(newUserButton()).toBeNull();
    expect(screen.getByRole('heading', { name: 'Usuarios y permisos' })).toBeTruthy();
  });

  it('usuario con varios roles: lo ve si entre ellos está ADMIN', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([]);
    renderPage(me(['COLLABORATOR', 'ADMIN']));
    expect(newUserButton()).toBeTruthy();
    await waitFor(() => expect(screen.getByText('No hay usuarios todavía.')).toBeTruthy());
  });

  it('canCreateUsersUI: solo ADMIN', () => {
    expect(canCreateUsersUI(me(['ADMIN']))).toBe(true);
    for (const role of ['PROGRAM_MANAGER', 'PROJECT_LEADER', 'COLLABORATOR', 'OBSERVER'] as RoleName[]) {
      expect(canCreateUsersUI(me([role]))).toBe(false);
    }
  });
});

describe('AdminUsersPage - crear usuario', () => {
  it('el botón abre el drawer "Nuevo usuario" y Cancelar lo cierra', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([existing]);
    renderPage(me(['ADMIN']));
    await screen.findAllByText('Ana Gómez');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(newUserButton()!);
    expect(screen.getByRole('dialog', { name: 'Nuevo usuario' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('al cerrar y reabrir, el formulario arranca limpio', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([existing]);
    renderPage(me(['ADMIN']));
    await screen.findAllByText('Ana Gómez');

    fireEvent.click(newUserButton()!);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Algo escrito' } });
    fireEvent.change(screen.getByLabelText('Contraseña inicial'), { target: { value: 'secreta-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    fireEvent.click(newUserButton()!);
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Contraseña inicial') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Rol inicial') as HTMLSelectElement).value).toBe('COLLABORATOR');
  });

  it('alta correcta: cierra el drawer, avisa, el usuario nuevo aparece en la tabla (activo, con su rol) y NO cambia la sesión', async () => {
    const list = vi.spyOn(api, 'listUsers').mockResolvedValueOnce([existing]).mockResolvedValue([existing, created]);
    const createUser = vi.spyOn(api, 'createUser').mockResolvedValue(created);
    const client = renderPage(me(['ADMIN']));
    await screen.findAllByText('Ana Gómez');
    const sessionBefore = client.getQueryData(['auth', 'me']);

    fireEvent.click(newUserButton()!);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Juan Pérez' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'juan@tema.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña inicial'), { target: { value: 'clave-1234' } });
    fireEvent.change(screen.getByLabelText('Rol inicial'), { target: { value: 'PROJECT_LEADER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));

    // POST /users con el DTO correcto
    await waitFor(() => expect(createUser).toHaveBeenCalledWith({ name: 'Juan Pérez', email: 'juan@tema.com', password: 'clave-1234', roles: ['PROJECT_LEADER'] }));
    // drawer cerrado + aviso
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('Usuario creado correctamente.');
    // el listado se refrescó solo (invalidación de ['users']): ahora hay una segunda consulta con el usuario nuevo
    await screen.findAllByText('Juan Pérez');
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
    // (la tabla y las tarjetas mobile se renderizan a la vez: cada dato aparece en ambas)
    expect(screen.getAllByText('juan@tema.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Activo').length).toBe(4); // Ana y Juan, en tabla y en tarjetas
    expect(screen.getAllByText('Líder de proyecto').length).toBeGreaterThan(0);
    // el alta no inicia sesión ni modifica al usuario actual
    expect(client.getQueryData(['auth', 'me'])).toBe(sessionBefore);
  });

  it('el usuario recién creado se puede abrir en el drawer existente de permisos', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValueOnce([existing]).mockResolvedValue([existing, created]);
    vi.spyOn(api, 'createUser').mockResolvedValue(created);
    renderPage(me(['ADMIN']));
    await screen.findAllByText('Ana Gómez');

    fireEvent.click(newUserButton()!);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Juan Pérez' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'juan@tema.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña inicial'), { target: { value: 'clave-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));

    const [row] = await screen.findAllByText('Juan Pérez');
    fireEvent.click(row!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Juan Pérez');
    expect(dialog.textContent).toContain('juan@tema.com');
  });

  it('error 409: el drawer sigue abierto, no se avisa éxito y el listado no se vuelve a pedir', async () => {
    const list = vi.spyOn(api, 'listUsers').mockResolvedValue([existing]);
    vi.spyOn(api, 'createUser').mockRejectedValue(new ApiRequestError(409, 'Conflict', ['Ya existe un usuario con ese email.']));
    renderPage(me(['ADMIN']));
    await screen.findAllByText('Ana Gómez');
    const listCallsBefore = list.mock.calls.length;

    fireEvent.click(newUserButton()!);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana Clon' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@tema.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña inicial'), { target: { value: 'clave-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));

    await waitFor(() => expect(screen.getAllByText('Ya existe un usuario con ese email.').length).toBeGreaterThan(0));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByText('Usuario creado correctamente.')).toBeNull();
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Ana Clon');
    expect(list.mock.calls.length).toBe(listCallsBefore);
  });
});
