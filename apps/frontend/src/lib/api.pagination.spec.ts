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
