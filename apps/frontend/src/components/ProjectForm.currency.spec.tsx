// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser, Project } from '@tema/shared-types';
import { ApiRequestError } from '../lib/api';
import { ProjectForm } from './ProjectForm';

const { api } = vi.hoisted(() => ({
  api: { createProject: vi.fn(), updateProject: vi.fn(), updateProjectStatus: vi.fn(), listUsers: vi.fn(), getMe: vi.fn(), listAllTasks: vi.fn() },
}));
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api }));

const me: AuthenticatedUser = { id: 'u-leader', email: 'l@tema.test', name: 'Lía Líder', avatarUrl: null, roles: ['PROJECT_LEADER'] };
const project = (extra: Partial<Project> = {}): Project =>
  ({
    id: 'p1', slug: 'proyecto', name: 'Proyecto', description: 'Descripción', startDate: '2026-10-01', estimatedEndDate: '2026-12-01', status: 'PLANNED',
    leaderId: 'u-leader', leader: { id: 'u-leader', name: 'Lía Líder' }, createdBy: 'u-leader', archivedAt: null, economicCurrency: 'ARS', economicCurrencyLocked: false, ...extra,
  }) as unknown as Project;

function renderForm(initialData?: Project) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['me'], me);
  client.setQueryData(['tasks', initialData?.id], []);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectForm initialData={initialData} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const currencySelect = () => screen.getByLabelText('Moneda del proyecto') as HTMLSelectElement;
const submit = () => fireEvent.submit(document.querySelector('form')!);
const fillCreate = () => {
  fireEvent.change(screen.getByLabelText(/Nombre del proyecto/), { target: { value: 'Nuevo' } });
  fireEvent.change(screen.getByLabelText(/Fecha de inicio/), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText(/Fecha de entrega/), { target: { value: '2026-12-01' } });
};

beforeEach(() => {
  api.createProject.mockResolvedValue({ id: 'p9', slug: 'nuevo' });
  api.updateProject.mockResolvedValue({ id: 'p1', slug: 'proyecto' });
  api.listUsers.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ProjectForm - moneda del proyecto (creación)', () => {
  it('es un SELECTOR con ARS y USD (no un input libre), con ARS por defecto', async () => {
    renderForm();
    const select = await screen.findByLabelText('Moneda del proyecto');
    expect(select.tagName).toBe('SELECT');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['ARS — Peso argentino', 'USD — Dólar estadounidense']);
    expect(currencySelect().value).toBe('ARS');
    expect(document.querySelector('input#economicCurrency')).toBeNull();
  });

  it('por defecto crea el proyecto en ARS', async () => {
    renderForm();
    await screen.findByLabelText('Moneda del proyecto');
    fillCreate();
    submit();
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0]![0]).toMatchObject({ economicCurrency: 'ARS' });
  });

  it('elegir USD crea el proyecto en USD', async () => {
    renderForm();
    await screen.findByLabelText('Moneda del proyecto');
    fillCreate();
    fireEvent.change(currencySelect(), { target: { value: 'USD' } });
    submit();
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0]![0]).toMatchObject({ economicCurrency: 'USD' });
  });
});

describe('ProjectForm - moneda del proyecto (edición)', () => {
  it('sin datos económicos: el selector está habilitado y muestra la moneda actual', async () => {
    renderForm(project({ economicCurrency: 'USD' }));
    expect(currencySelect().value).toBe('USD');
    expect(currencySelect().disabled).toBe(false);
    expect(screen.queryByText(/no puede modificarse porque el proyecto ya tiene información económica/)).toBeNull();
  });

  it('cambiar la moneda envía economicCurrency en el PATCH; si no se toca NO se envía', async () => {
    renderForm(project());
    fireEvent.change(currencySelect(), { target: { value: 'USD' } });
    submit();
    await waitFor(() => expect(api.updateProject).toHaveBeenCalled());
    expect(api.updateProject.mock.calls[0]![1]).toMatchObject({ economicCurrency: 'USD' });

    cleanup();
    api.updateProject.mockClear();
    renderForm(project());
    submit();
    await waitFor(() => expect(api.updateProject).toHaveBeenCalled());
    expect('economicCurrency' in api.updateProject.mock.calls[0]![1]).toBe(false);
  });

  it('con información económica el selector queda BLOQUEADO y explica por qué', async () => {
    renderForm(project({ economicCurrency: 'ARS', economicCurrencyLocked: true }));
    expect(currencySelect().value).toBe('ARS');
    expect(currencySelect().disabled).toBe(true);
    expect(screen.getByText('La moneda no puede modificarse porque el proyecto ya tiene información económica.')).toBeTruthy();
    expect(currencySelect().getAttribute('aria-describedby')).toBe('economicCurrencyHint');
  });

  it('si el proyecto no trae la moneda (quien edita no ve lo económico) no hay selector ni se envía nada', async () => {
    renderForm(project({ economicCurrency: undefined, economicCurrencyLocked: undefined }));
    expect(screen.queryByLabelText('Moneda del proyecto')).toBeNull();
    submit();
    await waitFor(() => expect(api.updateProject).toHaveBeenCalled());
    expect('economicCurrency' in api.updateProject.mock.calls[0]![1]).toBe(false);
  });

  it('409 PROJECT_CURRENCY_IN_USE del backend: mensaje claro', async () => {
    api.updateProject.mockRejectedValue(new ApiRequestError(409, 'Conflict', [], 'PROJECT_CURRENCY_IN_USE'));
    renderForm(project());
    fireEvent.change(currencySelect(), { target: { value: 'USD' } });
    submit();
    await screen.findByText('La moneda del proyecto ya no puede modificarse porque existen datos económicos.');
  });

  it('una moneda existente fuera de ARS/USD (p. ej. EUR de un dato viejo) se muestra tal cual', async () => {
    renderForm(project({ economicCurrency: 'EUR', economicCurrencyLocked: true }));
    expect(currencySelect().value).toBe('EUR');
  });
});
