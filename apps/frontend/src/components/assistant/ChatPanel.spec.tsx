// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AuthenticatedUser } from '@tema/shared-types';
import { api, ApiRequestError } from '../../lib/api';
import { ChatPanel } from './ChatPanel';

const userA = { id: 'user-a', email: 'a@tema.com', name: 'A', avatarUrl: null, roles: ['COLLABORATOR'] } as unknown as AuthenticatedUser;
const userB = { ...userA, id: 'user-b', email: 'b@tema.com', name: 'B' } as AuthenticatedUser;

function renderPanel(open = true, user: AuthenticatedUser = userA) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  // el panel vive dentro de una sesión ya iniciada: el usuario está cargado desde el principio
  client.setQueryData(['auth', 'me'], user);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChatPanel open={open} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const input = () => screen.getByPlaceholderText('Escribí tu pregunta...') as HTMLInputElement;

async function ask(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
}

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(api, 'getMe').mockResolvedValue(userA);
  vi.spyOn(api, 'getAssistantStatus').mockResolvedValue({ mode: 'gemini' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatPanel', () => {
  it('cerrado no renderiza nada', () => {
    renderPanel(false);
    expect(screen.queryByText('Asistente')).toBeNull();
  });

  it('muestra la pregunta y la respuesta del asistente', async () => {
    vi.spyOn(api, 'sendChatMessage').mockResolvedValue({ reply: 'No hay tareas vencidas.' });
    renderPanel();

    await ask('¿qué tareas están vencidas?');

    expect(screen.getByText('¿qué tareas están vencidas?')).toBeTruthy();
    expect(await screen.findByText('No hay tareas vencidas.')).toBeTruthy();
    expect(input().value).toBe('');
  });

  it('avisa que está consultando mientras espera la respuesta', async () => {
    let resolve!: (value: { reply: string }) => void;
    vi.spyOn(api, 'sendChatMessage').mockReturnValue(new Promise((r) => (resolve = r)));
    renderPanel();

    await ask('hola');

    expect(await screen.findByRole('status')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(true);

    resolve({ reply: 'Hola' });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('manda los mensajes anteriores como historial en la consulta siguiente', async () => {
    const send = vi.spyOn(api, 'sendChatMessage').mockResolvedValue({ reply: 'respuesta' });
    renderPanel();

    await ask('primera');
    await screen.findByText('respuesta');
    await ask('segunda');

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][2]).toEqual([
      { role: 'user', text: 'primera' },
      { role: 'assistant', text: 'respuesta' },
    ]);
  });

  it('con el servicio caído explica que no está disponible y ofrece reintentar', async () => {
    vi.spyOn(api, 'sendChatMessage').mockRejectedValue(new ApiRequestError(503, 'Service Unavailable'));
    renderPanel();

    await ask('hola');

    expect(await screen.findByText(/no está disponible/)).toBeTruthy();
    expect(screen.getByText(/sigue funcionando/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('con un 403 explica que falta permiso', async () => {
    vi.spyOn(api, 'sendChatMessage').mockRejectedValue(new ApiRequestError(403, 'Forbidden'));
    renderPanel();

    await ask('creá una tarea');

    expect(await screen.findByText(/No tenés permiso/)).toBeTruthy();
  });

  it('reintentar reenvía la misma pregunta y reemplaza el error por la respuesta', async () => {
    const send = vi
      .spyOn(api, 'sendChatMessage')
      .mockRejectedValueOnce(new ApiRequestError(503, 'Service Unavailable'))
      .mockResolvedValueOnce({ reply: 'Ahora sí' });
    renderPanel();

    await ask('hola');
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Ahora sí')).toBeTruthy();
    expect(screen.queryByText(/no está disponible/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    expect(send.mock.calls[1][0]).toBe('hola');
    // la pregunta no se duplica en la charla
    expect(screen.getAllByText('hola')).toHaveLength(1);
  });

  it('los mensajes de error no se mandan como historial', async () => {
    const send = vi
      .spyOn(api, 'sendChatMessage')
      .mockRejectedValueOnce(new ApiRequestError(503, 'Service Unavailable'))
      .mockResolvedValueOnce({ reply: 'listo' });
    renderPanel();

    await ask('primera');
    await screen.findByText(/no está disponible/);
    await ask('segunda');

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][2]).toEqual([{ role: 'user', text: 'primera' }]);
  });

  it('la charla se conserva al volver a montar el panel (recarga de la página)', async () => {
    vi.spyOn(api, 'sendChatMessage').mockResolvedValue({ reply: 'respuesta guardada' });
    const first = renderPanel();
    await ask('pregunta guardada');
    await screen.findByText('respuesta guardada');

    first.unmount();
    renderPanel();

    expect(await screen.findByText('pregunta guardada')).toBeTruthy();
    expect(screen.getByText('respuesta guardada')).toBeTruthy();
  });

  it('la charla de un usuario no la ve otro usuario en la misma pestaña', async () => {
    vi.spyOn(api, 'sendChatMessage').mockResolvedValue({ reply: 'solo para A' });
    const first = renderPanel();
    await ask('pregunta de A');
    await screen.findByText('solo para A');
    first.unmount();

    renderPanel(true, userB);

    await waitFor(() => expect(screen.queryByText('pregunta de A')).toBeNull());
  });

  it('muestra la etiqueta "Modo demo" cuando el backend responde por reglas', async () => {
    vi.mocked(api.getAssistantStatus).mockResolvedValue({ mode: 'rules' });
    renderPanel();

    expect(await screen.findByText('Modo demo')).toBeTruthy();
  });

  it('no muestra "Modo demo" con Gemini', async () => {
    renderPanel();

    await waitFor(() => expect(api.getAssistantStatus).toHaveBeenCalled());
    expect(screen.queryByText('Modo demo')).toBeNull();
  });
});
