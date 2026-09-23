import { TaskStatus } from '../database/enums';

/**
 * Mapa de transiciones válidas de estado para tareas.
 * Fuente: RF-TA-02, RN-04, RN-13, RN-15, CU-06. Especificado en el SRS del cliente.
 */
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.PENDING]:     [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.IN_REVIEW, TaskStatus.BLOCKED, TaskStatus.COMPLETED],
  [TaskStatus.IN_REVIEW]:   [TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS],
  [TaskStatus.BLOCKED]:     [TaskStatus.PENDING],
  [TaskStatus.COMPLETED]:   [],
  [TaskStatus.CANCELLED]:   [],
};

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]:     'Pendiente',
  [TaskStatus.IN_PROGRESS]: 'En curso',
  [TaskStatus.IN_REVIEW]:   'En revisión',
  [TaskStatus.BLOCKED]:     'Bloqueada',
  [TaskStatus.COMPLETED]:   'Completada',
  [TaskStatus.CANCELLED]:   'Cancelada',
};