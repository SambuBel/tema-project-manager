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

    it('cada estado debería permitir transiciones a todos los demás estados', () => {
      const allStatuses = Object.values(TaskStatus);
      allStatuses.forEach((status) => {
        const allowed = VALID_TRANSITIONS[status];
        expect(allowed).toHaveLength(allStatuses.length - 1);
        expect(allowed).not.toContain(status);
      });
    });

    it('COMPLETED no es un estado final y permite transicionar a otros estados', () => {
      expect(VALID_TRANSITIONS[TaskStatus.COMPLETED]).toContain(TaskStatus.IN_PROGRESS);
      expect(VALID_TRANSITIONS[TaskStatus.COMPLETED]).toContain(TaskStatus.PENDING);
      expect(VALID_TRANSITIONS[TaskStatus.COMPLETED]).toContain(TaskStatus.IN_REVIEW);
      expect(VALID_TRANSITIONS[TaskStatus.COMPLETED]).toContain(TaskStatus.BLOCKED);
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
      [TaskStatus.PENDING, TaskStatus.COMPLETED],
      [TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS],
      [TaskStatus.BLOCKED, TaskStatus.IN_REVIEW],
      [TaskStatus.IN_REVIEW, TaskStatus.PENDING],
      [TaskStatus.IN_PROGRESS, TaskStatus.PENDING],
      [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
      [TaskStatus.PENDING, TaskStatus.BLOCKED],
      [TaskStatus.PENDING, TaskStatus.IN_REVIEW],
      [TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW],
      [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED],
      [TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED],
      [TaskStatus.IN_REVIEW, TaskStatus.COMPLETED],
      [TaskStatus.IN_REVIEW, TaskStatus.IN_PROGRESS],
      [TaskStatus.IN_REVIEW, TaskStatus.BLOCKED],
      [TaskStatus.BLOCKED, TaskStatus.PENDING],
      [TaskStatus.BLOCKED, TaskStatus.IN_PROGRESS],
      [TaskStatus.BLOCKED, TaskStatus.COMPLETED],
      [TaskStatus.COMPLETED, TaskStatus.PENDING],
      [TaskStatus.COMPLETED, TaskStatus.IN_REVIEW],
      [TaskStatus.COMPLETED, TaskStatus.BLOCKED],
    ])('debería permitir la transición %s → %s', (from, to) => {
      expect(isValidTransition(from, to)).toBe(true);
    });

    it('debería rechazar la transición al mismo estado', () => {
      Object.values(TaskStatus).forEach((status) => {
        expect(isValidTransition(status, status)).toBe(false);
      });
    });

    it('debería rechazar si el estado origen o destino no es válido', () => {
      expect(isValidTransition('INVALID' as any, TaskStatus.PENDING)).toBe(false);
      expect(isValidTransition(TaskStatus.PENDING, 'INVALID' as any)).toBe(false);
    });
  });
});