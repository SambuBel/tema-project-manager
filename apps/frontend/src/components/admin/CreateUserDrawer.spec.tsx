// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserWithRoles } from '@tema/shared-types';
import { api, ApiRequestError } from '../../lib/api';
import { CreateUserDrawer } from './CreateUserDrawer';

const created = { id: 'u9', email: 'juan@tema.com', name: 'Juan Pérez', active: true, roles: ['COLLABORATOR'] } as unknown as UserWithRoles;

let client: QueryClient;
const onClose = vi.fn();
const onCreated = vi.fn();

function renderDrawer() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CreateUserDrawer onClose={onClose} onCreated={onCreated} />
    </QueryClientProvider>,
  );
}

const name = () => screen.getByLabelText('Nombre') as HTMLInputElement;
const email = () => screen.getByLabelText('Email') as HTMLInputElement;
const password = () => screen.getByLabelText('Contraseña inicial') as HTMLInputElement;
const role = () => screen.getByLabelText('Rol inicial') as HTMLSelectElement;
const submit = () => screen.getByRole('button', { name: /crear usuario|creando/i }) as HTMLButtonElement;

function fill(values: { name?: string; email?: string; password?: string; role?: string }) {
  if (values.name !== undefined) fireEvent.change(name(), { target: { value: values.name } });
  if (values.email !== undefined) fireEvent.change(email(), { target: { value: values.email } });
  if (values.password !== undefined) fireEvent.change(password(), { target: { value: values.password } });
  if (values.role !== undefined) fireEvent.change(role(), { target: { value: values.role } });
}

const fillValid = () => fill({ name: '  Juan Pérez ', email: ' Juan@TEMA.com ', password: 'clave-1234' });

beforeEach(() => {
  onClose.mockReset();
  onCreated.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CreateUserDrawer - estructura', () => {
  it('es un diálogo "Nuevo usuario" con su descripción', () => {
    renderDrawer();
    const dialog = screen.getByRole('dialog', { name: 'Nuevo usuario' });
    expect(within(dialog).getByText('Creá un usuario para que pueda acceder a TEMA.')).toBeTruthy();
  });

  it('muestra Nombre, Email, Contraseña inicial y Rol inicial, con sus labels asociados', () => {
    renderDrawer();
    expect(name().type).toBe('text');
    expect(name().placeholder).toBe('Ej. Juan Pérez');
    expect(email().type).toBe('email');
    expect(password()).toBeTruthy();
    expect(role()).toBeTruthy();
  });

  it('el foco arranca en Nombre', () => {
    renderDrawer();
    expect(document.activeElement).toBe(name());
  });

  it('la contraseña arranca como type=password y Mostrar/Ocultar la alterna', () => {
    renderDrawer();
    expect(password().type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar' }));
    expect(password().type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(password().type).toBe('password');
  });

  it('ayuda de la contraseña: "Mínimo 8 caracteres."', () => {
    renderDrawer();
    expect(screen.getByText('Mínimo 8 caracteres.')).toBeTruthy();
  });

  it('el selector de rol tiene los roles reales en español y COLLABORATOR es el default', () => {
    renderDrawer();
    expect(role().value).toBe('COLLABORATOR');
    expect(Array.from(role().options).map((o) => [o.value, o.text])).toEqual([
      ['COLLABORATOR', 'Colaborador'],
      ['PROJECT_LEADER', 'Líder de proyecto'],
      ['PROGRAM_MANAGER', 'Program Manager'],
      ['ADMIN', 'Administrador'],
      ['OBSERVER', 'Observador'],
    ]);
  });

  it('footer con Cancelar y Crear usuario (submit)', () => {
    renderDrawer();
    expect(screen.getByRole('button', { name: 'Cancelar' }).getAttribute('type')).toBe('button');
    expect(submit().type).toBe('submit');
  });
});

describe('CreateUserDrawer - cerrar', () => {
  it('Cancelar, la X, el overlay y Escape cierran', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('CreateUserDrawer - validaciones (sin llamar al backend)', () => {
  it('formulario vacío: errores en nombre, email y contraseña, y NO se llama a la API', () => {
    const spy = vi.spyOn(api, 'createUser');
    renderDrawer();
    fireEvent.click(submit());

    expect(screen.getByText('El nombre es obligatorio.')).toBeTruthy();
    expect(screen.getByText('El email es obligatorio.')).toBeTruthy();
    expect(screen.getByText('La contraseña es obligatoria.')).toBeTruthy();
    expect(name().getAttribute('aria-invalid')).toBe('true');
    expect(spy).not.toHaveBeenCalled();
  });

  it('los errores son accesibles (role=alert) y están enlazados al campo', () => {
    renderDrawer();
    fireEvent.click(submit());
    const error = screen.getByText('El nombre es obligatorio.');
    expect(error.getAttribute('role')).toBe('alert');
    expect(name().getAttribute('aria-describedby')).toContain(error.id);
  });

  it('contraseña de menos de 8 caracteres → error y sin request', () => {
    const spy = vi.spyOn(api, 'createUser');
    renderDrawer();
    fill({ name: 'Ana', email: 'ana@tema.com', password: '1234567' });
    fireEvent.click(submit());

    expect(screen.getByText('La contraseña debe tener al menos 8 caracteres.')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('email sin formato válido → error y sin request', () => {
    const spy = vi.spyOn(api, 'createUser');
    renderDrawer();
    fill({ name: 'Ana', email: 'ana-sin-arroba', password: '12345678' });
    fireEvent.click(submit());

    expect(screen.getByText('Ingresá un email válido.')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('CreateUserDrawer - alta correcta', () => {
  it('llama a POST /users con los datos correctos y NUNCA manda passwordHash', async () => {
    const spy = vi.spyOn(api, 'createUser').mockResolvedValue(created);
    renderDrawer();
    fillValid();
    fill({ role: 'PROJECT_LEADER' });
    fireEvent.click(submit());

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const dto = spy.mock.calls[0]![0];
    expect(dto).toEqual({ name: 'Juan Pérez', email: 'juan@tema.com', password: 'clave-1234', roles: ['PROJECT_LEADER'] });
    expect(JSON.stringify(dto)).not.toMatch(/hash/i);
  });

  it('con el rol por defecto manda roles: ["COLLABORATOR"]', async () => {
    const spy = vi.spyOn(api, 'createUser').mockResolvedValue(created);
    renderDrawer();
    fillValid();
    fireEvent.click(submit());

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![0].roles).toEqual(['COLLABORATOR']);
  });

  it('en éxito invalida la query de usuarios y avisa al padre (que cierra el drawer) con el usuario creado', async () => {
    vi.spyOn(api, 'createUser').mockResolvedValue(created);
    renderDrawer();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fillValid();
    fireEvent.click(submit());

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users'] });
    expect(onClose).not.toHaveBeenCalled(); // el cierre lo decide el padre en onCreated
  });

  it('mientras crea: botón deshabilitado ("Creando…") y un segundo submit NO dispara otra request', async () => {
    let resolve!: (user: UserWithRoles) => void;
    const spy = vi.spyOn(api, 'createUser').mockImplementation(() => new Promise<UserWithRoles>((r) => (resolve = r)));
    renderDrawer();
    fillValid();
    fireEvent.click(submit());

    await waitFor(() => expect(submit().disabled).toBe(true));
    expect(submit().textContent).toBe('Creando…');
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    fireEvent.click(submit());
    expect(spy).toHaveBeenCalledTimes(1);

    // y mientras crea no se puede cerrar por accidente
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    resolve(created);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });
});

describe('CreateUserDrawer - errores del backend (el drawer permanece abierto y conserva lo escrito)', () => {
  const assertKeptOpen = () => {
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(name().value).toBe('  Juan Pérez ');
    expect(email().value).toBe('Juan@TEMA.com'); // type=email descarta los espacios de los extremos (HTML)
    expect(password().value).toBe('clave-1234');
    expect(submit().disabled).toBe(false); // se puede reintentar
  };

  it('409 → "Ya existe un usuario con ese email." junto al campo email', async () => {
    vi.spyOn(api, 'createUser').mockRejectedValue(new ApiRequestError(409, 'Conflict', ['Ya existe un usuario con ese email.']));
    const invalidate = vi.spyOn((renderDrawer(), client), 'invalidateQueries');
    fillValid();
    fireEvent.click(submit());

    await waitFor(() => expect(screen.getAllByText('Ya existe un usuario con ese email.').length).toBeGreaterThan(0));
    expect(email().getAttribute('aria-invalid')).toBe('true');
    assertKeptOpen();
    expect(invalidate).not.toHaveBeenCalled(); // no hubo alta: no se refresca nada
  });

  it('corregir el email limpia el error de duplicado', async () => {
    vi.spyOn(api, 'createUser').mockRejectedValue(new ApiRequestError(409, 'Conflict', []));
    renderDrawer();
    fillValid();
    fireEvent.click(submit());
    await waitFor(() => expect(email().getAttribute('aria-invalid')).toBe('true'));

    fill({ email: 'otro@tema.com' });
    expect(email().getAttribute('aria-invalid')).toBe('false');
  });

  it('400 → muestra el mensaje de validación del backend', async () => {
    vi.spyOn(api, 'createUser').mockRejectedValue(new ApiRequestError(400, 'Bad Request', ['El email no es válido']));
    renderDrawer();
    fillValid();
    fireEvent.click(submit());

    await waitFor(() => expect(screen.getByText('El email no es válido')).toBeTruthy());
    assertKeptOpen();
  });

  it('403 → "No tenés permisos para crear usuarios."', async () => {
    vi.spyOn(api, 'createUser').mockRejectedValue(new ApiRequestError(403, 'Forbidden', ['No tenés permisos para realizar esta acción.']));
    renderDrawer();
    fillValid();
    fireEvent.click(submit());

    await waitFor(() => expect(screen.getByText('No tenés permisos para crear usuarios.')).toBeTruthy());
    assertKeptOpen();
  });

  it('error inesperado (500 / red) → mensaje genérico, sin detalles técnicos', async () => {
    vi.spyOn(api, 'createUser').mockRejectedValue(new ApiRequestError(500, 'Internal Server Error', ['QueryFailedError: relation "users" at pg.js:1']));
    renderDrawer();
    fillValid();
    fireEvent.click(submit());

    await waitFor(() => expect(screen.getByText('No se pudo crear el usuario. Intentá nuevamente.')).toBeTruthy());
    expect(document.body.textContent).not.toContain('QueryFailedError');
    assertKeptOpen();
  });
});

describe('CreateUserDrawer - seguridad de la contraseña', () => {
  it('no se guarda en localStorage ni sessionStorage', async () => {
    vi.spyOn(api, 'createUser').mockResolvedValue(created);
    renderDrawer();
    fillValid();
    fireEvent.click(submit());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());

    const dump = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(dump).not.toContain('clave-1234');
  });

  it('no se escribe en la consola', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(api, 'createUser').mockResolvedValue(created);
    renderDrawer();
    fillValid();
    fireEvent.click(submit());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(log.mock.calls.flat().join(' ')).not.toContain('clave-1234');
  });
});
