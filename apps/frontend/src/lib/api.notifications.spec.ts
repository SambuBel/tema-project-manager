import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => { vi.restoreAllMocks(); });

it('consulta notificaciones con filtros, paginacion y la cookie de sesion', async () => {
  const page = { items: [], total: 0, unreadCount: 0 };
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true, status: 200, json: async () => page,
  } as Response);

  expect(await api.listNotifications({ unreadOnly: false, limit: 20, offset: 0 })).toEqual(page);
  expect(fetchSpy).toHaveBeenCalledWith('/api/notifications?unreadOnly=false&limit=20&offset=0',
    expect.objectContaining({ credentials: 'include' }));
});

it('guarda preferencias con la estructura que valida el backend', async () => {
  const preferences = [{ type: 'TASK_ASSIGNED' as const, enabled: false }];
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true, status: 200, json: async () => preferences,
  } as Response);

  expect(await api.updateNotificationPreferences(preferences)).toEqual(preferences);
  expect(fetchSpy).toHaveBeenCalledWith('/api/notifications/preferences', expect.objectContaining({
    method: 'PUT', credentials: 'include', body: JSON.stringify({ preferences }),
  }));
});
