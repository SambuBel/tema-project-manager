import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';
import type { Task } from '../types/task';

afterEach(() => { vi.restoreAllMocks(); });

it('carga todas las páginas para no truncar el tablero ni la validación de fechas', async () => {
  const firstTask = { id: 'first' } as Task;
  const lastTask = { id: 'last' } as Task;
  const list = vi.spyOn(api, 'listTasks')
    .mockResolvedValueOnce({ data: [firstTask], page: 1, limit: 100, total: 101, totalPages: 2, counts: { all: 101, mine: 0, atRisk: 0 } })
    .mockResolvedValueOnce({ data: [lastTask], page: 2, limit: 100, total: 101, totalPages: 2, counts: { all: 101, mine: 0, atRisk: 0 } });

  expect(await api.listAllTasks({ projectId: 'project-1' })).toEqual([firstTask, lastTask]);
  expect(list).toHaveBeenNthCalledWith(2, { projectId: 'project-1', page: 2, limit: 100 });
});

it('listTasks envía includeSubtasks=true cuando se solicita', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: [], page: 1, limit: 10, total: 0, totalPages: 0, counts: { all: 0, mine: 0, atRisk: 0 } }),
  } as Response);

  await api.listTasks({ projectId: 'p1', includeSubtasks: true });

  expect(fetchSpy).toHaveBeenCalledWith('/api/tasks?projectId=p1&includeSubtasks=true', expect.anything());
});

it('listTasks omite includeSubtasks en la query por defecto', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: [], page: 1, limit: 10, total: 0, totalPages: 0, counts: { all: 0, mine: 0, atRisk: 0 } }),
  } as Response);

  await api.listTasks({ projectId: 'p1' });

  expect(fetchSpy).toHaveBeenCalledWith('/api/tasks?projectId=p1', expect.anything());
});
