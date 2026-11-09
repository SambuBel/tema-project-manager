// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@tema/shared-types';
import { api } from '../../lib/api';
import { SidebarUser } from './SidebarUser';

vi.mock('../../lib/api', () => ({ api: { logout: vi.fn() } }));

/** BUG-17: el diálogo de cierre de sesión no puede nombrar un método de login (no se sabe con cuál entró el usuario). */

const user: AuthenticatedUser = { id: 'u1', email: 'ana@demo.tema.test', name: 'Ana Admin', avatarUrl: null, roles: ['ADMIN'] };

const NEUTRAL_TEXT = 'Vas a tener que volver a iniciar sesión para seguir usando TEMA.';

function renderUser() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SidebarUser user={user} />
    </QueryClientProvider>,
  );
}

const openDialog = () => fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

const originalLocation = window.location;

beforeEach(() => {
  vi.mocked(api.logout).mockReset().mockResolvedValue(undefined);
  // El logout termina con window.location.href = '/': jsdom no implementa la navegación, se reemplaza por un objeto simple.
  Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/' } });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('SidebarUser - diálogo de cierre de sesión (BUG-17)', () => {
  it('al abrirlo muestra el texto neutral', () => {
    renderUser();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    openDialog();

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(NEUTRAL_TEXT)).toBeTruthy();
  });

  it('el diálogo no menciona a Google en ningún texto', () => {
    renderUser();
    openDialog();

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).not.toMatch(/google/i);
  });

  it('confirmar cierra la sesión: llama al logout y vuelve a la raíz', async () => {
    renderUser();
    openDialog();

    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cerrar sesión' }));

    await waitFor(() => expect(api.logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.href).toBe('/'));
  });

  it('cancelar cierra el diálogo sin cerrar la sesión', () => {
    renderUser();
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
  });
});
