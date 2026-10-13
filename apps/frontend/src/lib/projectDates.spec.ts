import { describe, expect, it } from 'vitest';
import type { Task } from '@tema/shared-types';
import {
  findTasksOutsidePeriod,
  isTaskDatesConsistent,
  isTaskExceedingProjectEnd,
  isTaskPrecedingProjectStart,
  normalizeDateString,
} from './projectDates';

describe('normalizeDateString', () => {
  it('normaliza YYYY-MM-DD', () => {
    expect(normalizeDateString('2026-10-15')).toBe('2026-10-15');
  });

  it('normaliza formato ISO con T', () => {
    expect(normalizeDateString('2026-10-15T00:00:00.000Z')).toBe('2026-10-15');
  });

  it('valores vacíos o nulos devuelven null', () => {
    expect(normalizeDateString(null)).toBeNull();
    expect(normalizeDateString(undefined)).toBeNull();
    expect(normalizeDateString('')).toBeNull();
    expect(normalizeDateString('   ')).toBeNull();
  });
});

describe('isTaskExceedingProjectEnd (RN-08)', () => {
  it('devuelve true si dueDate es estrictamente posterior al fin del proyecto', () => {
    expect(isTaskExceedingProjectEnd('2026-11-01', '2026-10-31')).toBe(true);
    expect(isTaskExceedingProjectEnd('2026-10-31T00:00:00Z', '2026-10-30T00:00:00Z')).toBe(true);
  });

  it('devuelve false si dueDate es igual o anterior al fin del proyecto', () => {
    expect(isTaskExceedingProjectEnd('2026-10-31', '2026-10-31')).toBe(false);
    expect(isTaskExceedingProjectEnd('2026-10-15', '2026-10-31')).toBe(false);
  });

  it('devuelve false si falta alguna de las fechas', () => {
    expect(isTaskExceedingProjectEnd(null, '2026-10-31')).toBe(false);
    expect(isTaskExceedingProjectEnd('2026-10-31', null)).toBe(false);
    expect(isTaskExceedingProjectEnd(undefined, undefined)).toBe(false);
  });
});

describe('isTaskPrecedingProjectStart', () => {
  it('devuelve true si startDate de la tarea es anterior al inicio del proyecto', () => {
    expect(isTaskPrecedingProjectStart('2026-09-30', '2026-10-01')).toBe(true);
  });

  it('devuelve false si startDate es igual o posterior al inicio del proyecto', () => {
    expect(isTaskPrecedingProjectStart('2026-10-01', '2026-10-01')).toBe(false);
    expect(isTaskPrecedingProjectStart('2026-10-15', '2026-10-01')).toBe(false);
  });

  it('devuelve false si falta alguna fecha', () => {
    expect(isTaskPrecedingProjectStart(null, '2026-10-01')).toBe(false);
    expect(isTaskPrecedingProjectStart('2026-10-01', null)).toBe(false);
  });
});

describe('isTaskDatesConsistent (RN-17)', () => {
  it('devuelve true si dueDate es igual o posterior a startDate', () => {
    expect(isTaskDatesConsistent('2026-10-01', '2026-10-01')).toBe(true);
    expect(isTaskDatesConsistent('2026-10-01', '2026-10-10')).toBe(true);
  });

  it('devuelve false si startDate es posterior a dueDate', () => {
    expect(isTaskDatesConsistent('2026-10-15', '2026-10-10')).toBe(false);
  });

  it('devuelve true si falta alguna de las dos fechas', () => {
    expect(isTaskDatesConsistent(null, '2026-10-10')).toBe(true);
    expect(isTaskDatesConsistent('2026-10-01', null)).toBe(true);
    expect(isTaskDatesConsistent(null, null)).toBe(true);
  });
});

describe('findTasksOutsidePeriod', () => {
  const baseTask = (id: string, start: string | null, due: string | null, archivedAt: string | null = null): Task =>
    ({
      id,
      title: `Tarea ${id}`,
      startDate: start,
      dueDate: due,
      archivedAt,
      projectId: 'proj-1',
      parentTaskId: null,
      description: null,
      status: 'PENDING',
      priority: 'MEDIUM',
      assignedToId: null,
      createdBy: 'user-1',
      createdAt: '2026-10-01',
      updatedAt: '2026-10-01',
    }) as Task;

  it('detecta tareas cuyo vencimiento supera la nueva fecha fin', () => {
    const tasks = [
      baseTask('1', '2026-10-05', '2026-10-25'), // dentro
      baseTask('2', '2026-10-05', '2026-11-05'), // excede fin
    ];

    const affected = findTasksOutsidePeriod(tasks, '2026-10-01', '2026-10-31');
    expect(affected).toHaveLength(1);
    expect(affected[0].task.id).toBe('2');
    expect(affected[0].exceedsEnd).toBe(true);
  });

  it('detecta tareas cuyo inicio es anterior a la nueva fecha inicio', () => {
    const tasks = [
      baseTask('1', '2026-09-20', '2026-10-25'), // inicio anterior
    ];

    const affected = findTasksOutsidePeriod(tasks, '2026-10-01', '2026-10-31');
    expect(affected).toHaveLength(1);
    expect(affected[0].task.id).toBe('1');
    expect(affected[0].precedesStart).toBe(true);
  });

  it('ignora tareas archivadas', () => {
    const tasks = [
      baseTask('archived', '2026-09-01', '2026-12-01', '2026-10-01'),
    ];

    const affected = findTasksOutsidePeriod(tasks, '2026-10-01', '2026-10-31');
    expect(affected).toHaveLength(0);
  });

  it('no reporta tareas sin fechas o que caen dentro del período', () => {
    const tasks = [
      baseTask('1', null, null),
      baseTask('2', '2026-10-10', '2026-10-20'),
    ];

    const affected = findTasksOutsidePeriod(tasks, '2026-10-01', '2026-10-31');
    expect(affected).toHaveLength(0);
  });
});
