import { TaskStatus } from '../database/enums';
import {
  isValidTransition,
  VALID_TRANSITIONS,
  TASK_STATUS_LABELS,
} from './task-transitions';

describe('task-transitions', () => {
  describe('VALID_TRANSITIONS', () => {
    it('debería definir transiciones para todos los estados', () => {
      const allStatuses = Object.values(TaskStatus);
      const definedStatuses = Object.keys(VALID_TRANSITIONS);

      expect(definedStatuses).toHaveLength(allStatuses.length);
      allStatuses.forEach((status) => {
        expect(VALID_TRANSITIONS).toHaveProperty(status);
      });
    });

    it('COMPLETED y CANCELLED deberían ser estados finales (sin transiciones)', () => {
      expect(VALID_TRANSITIONS[TaskStatus.COMPLETED]).toEqual([]);
      expect(VALID_TRANSITIONS[TaskStatus.CANCELLED]).toEqual([]);
    });
  });

  describe('TASK_STATUS_LABELS', () => {
    it('debería tener una etiqueta para cada estado', () => {
      Object.values(TaskStatus).forEach((status) => {
        expect(TASK_STATUS_LABELS[status]).toBeDefined();
        expect(typeof TASK_STATUS_LABELS[status]).toBe('string');
      });
    });
  });

  describe('isValidTransition', () => {
    it.each([
      [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
      [TaskStatus.PENDING, TaskStatus.BLOCKED],
      [TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW],
      [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED],
      [TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED],
      [TaskStatus.IN_REVIEW, TaskStatus.COMPLETED],
      [TaskStatus.IN_REVIEW, TaskStatus.IN_PROGRESS],
      [TaskStatus.BLOCKED, TaskStatus.PENDING],
    ])('debería permitir la transición %s → %s', (from, to) => {
      expect(isValidTransition(from, to)).toBe(true);
    });

    it.each([
      [TaskStatus.PENDING, TaskStatus.COMPLETED],
      [TaskStatus.PENDING, TaskStatus.IN_REVIEW],
      [TaskStatus.PENDING, TaskStatus.CANCELLED],
      [TaskStatus.IN_PROGRESS, TaskStatus.PENDING],
      [TaskStatus.IN_REVIEW, TaskStatus.BLOCKED],
      [TaskStatus.IN_REVIEW, TaskStatus.PENDING],
      [TaskStatus.BLOCKED, TaskStatus.IN_PROGRESS],
      [TaskStatus.BLOCKED, TaskStatus.COMPLETED],
      [TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS],
      [TaskStatus.COMPLETED, TaskStatus.PENDING],
      [TaskStatus.CANCELLED, TaskStatus.PENDING],
      [TaskStatus.CANCELLED, TaskStatus.IN_PROGRESS],
    ])('debería rechazar la transición %s → %s', (from, to) => {
      expect(isValidTransition(from, to)).toBe(false);
    });

    it('debería rechazar la transición al mismo estado', () => {
      Object.values(TaskStatus).forEach((status) => {
        expect(isValidTransition(status, status)).toBe(false);
      });
    });
  });
});