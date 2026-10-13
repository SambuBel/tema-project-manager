import { TaskStatus } from '../database/enums';

const ALL_STATUSES: TaskStatus[] = [
  TaskStatus.PENDING,
  TaskStatus.IN_PROGRESS,
  TaskStatus.IN_REVIEW,
  TaskStatus.BLOCKED,
  TaskStatus.COMPLETED,
];

/**
 * Mapa de transiciones válidas de estado para tareas.
 * Según el documento funcional de TEMA Consulting v1.0, se permiten transiciones
 * entre cualquiera de los estados existentes siempre que el usuario tenga permisos
 * y se respeten las reglas de negocio (RN-04, RN-13).
 */
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.PENDING]:     ALL_STATUSES.filter((s) => s !== TaskStatus.PENDING),
  [TaskStatus.IN_PROGRESS]: ALL_STATUSES.filter((s) => s !== TaskStatus.IN_PROGRESS),
  [TaskStatus.IN_REVIEW]:   ALL_STATUSES.filter((s) => s !== TaskStatus.IN_REVIEW),
  [TaskStatus.BLOCKED]:     ALL_STATUSES.filter((s) => s !== TaskStatus.BLOCKED),
  [TaskStatus.COMPLETED]:   ALL_STATUSES.filter((s) => s !== TaskStatus.COMPLETED),
};

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]:     'Pendiente',
  [TaskStatus.IN_PROGRESS]: 'En curso',
  [TaskStatus.IN_REVIEW]:   'En revisión',
  [TaskStatus.BLOCKED]:     'Bloqueada',
  [TaskStatus.COMPLETED]:   'Completada'
};