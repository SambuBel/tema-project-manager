// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@tema/shared-types';
import { ProjectForm } from './ProjectForm';

const { api } = vi.hoisted(() => ({
  api: { createProject: vi.fn(), updateProject: vi.fn(), updateProjectStatus: vi.fn(), listUsers: vi.fn(), getMe: vi.fn(), listAllTasks: vi.fn() },
}));
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api }));

const me: AuthenticatedUser = { id: 'u-leader', email: 'l@tema.test', name: 'Lía Líder', avatarUrl: null, roles: ['PROJECT_LEADER'] };

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['me'], me);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectForm />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fillRequired = () => {
  fireEvent.change(screen.getByLabelText(/Nombre del proyecto/), { target: { value: 'Proyecto Nuevo' } });
  fireEvent.change(screen.getByLabelText(/Objetivo/), { target: { value: 'Descripción del proyecto' } });
  fireEvent.change(screen.getByLabelText(/Fecha de inicio/), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText(/Fecha de entrega/), { target: { value: '2026-12-01' } });
};

beforeEach(() => {
  api.listUsers.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ProjectForm - prevención de doble envío al crear', () => {
  it('ignora un doble clic rápido y envía un único pedido con idempotencyKey', async () => {
    let resolveCreate!: (val: { id: string; slug: string }) => void;
    api.createProject.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    renderForm();
    fillRequired();

    const submitBtn = screen.getByRole('button', { name: 'Crear proyecto' }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);

    const form = document.querySelector('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
    expect(api.createProject.mock.calls[0]![0]).toMatchObject({
      name: 'Proyecto Nuevo',
      idempotencyKey: expect.any(String),
    });

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Guardando...' }) as HTMLButtonElement).disabled).toBe(true);
    });

    resolveCreate({ id: 'p1', slug: 'proyecto-nuevo' });
  });

  it('si la creación falla, vuelve a habilitar el botón y permite reintentar con la misma idempotencyKey', async () => {
    api.createProject.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({ id: 'p1', slug: 'proyecto-nuevo' });

    renderForm();
    fillRequired();

    const form = document.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('Error al crear.')).toBeTruthy();
    });

    const retryBtn = screen.getByRole('button', { name: 'Crear proyecto' }) as HTMLButtonElement;
    expect(retryBtn.disabled).toBe(false);

    fireEvent.submit(form);

    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(2));
    expect(api.createProject.mock.calls[0]![0].idempotencyKey).toBe(api.createProject.mock.calls[1]![0].idempotencyKey);
  });
});
