import { ApiRequestError } from './api';

/**
 * Mensaje para cuando falla la carga de un proyecto o una tarea (BUG-13), según el status HTTP que ya viaja en
 * ApiRequestError: no existe, sin acceso, u otro error. El backend es la autoridad; esto solo explica el resultado.
 */
interface LoadErrorMessages {
  notFound: string;
  forbidden: string;
}

function describe(error: unknown, messages: LoadErrorMessages, fallback: string, notFoundStatuses: number[]): string {
  if (error instanceof ApiRequestError) {
    if (notFoundStatuses.includes(error.status)) return messages.notFound;
    if (error.status === 403) return messages.forbidden;
  }
  return fallback;
}

const PROJECT_MESSAGES: LoadErrorMessages = {
  notFound: 'El proyecto no existe o fue eliminado.',
  forbidden: 'No tenés acceso a este proyecto.',
};

const TASK_MESSAGES: LoadErrorMessages = {
  notFound: 'La tarea no existe o fue eliminada.',
  forbidden: 'No tenés acceso a esta tarea.',
};

export function projectLoadErrorMessage(error: unknown, fallback = 'Error al cargar el proyecto.'): string {
  return describe(error, PROJECT_MESSAGES, fallback, [404]);
}

/** Para tareas un 400 también es "no existe": el id de la URL no tiene formato válido (ya era así en EditTaskPage). */
export function taskLoadErrorMessage(error: unknown, fallback = 'Error al cargar la tarea.'): string {
  return describe(error, TASK_MESSAGES, fallback, [400, 404]);
}
