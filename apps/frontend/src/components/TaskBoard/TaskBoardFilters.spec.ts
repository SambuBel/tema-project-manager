import { describe, it, expect } from 'vitest';
import type { Task } from '../../types/task';
import { applyBoardFilters } from './TaskBoardFilters';

describe('applyBoardFilters', () => {
  it('no muestra las tareas archivadas', () => {
    const tasks = [
      { id: 'activa', archivedAt: null },
      { id: 'archivada', archivedAt: '2026-11-02T00:00:00.000Z' },
    ] as Task[];

    expect(applyBoardFilters(tasks, '', '').map((t) => t.id)).toEqual(['activa']);
  });
});
