import { ApiRequestError } from './api';

/**
 * Texto que ve el usuario cuando falla una consulta al asistente. Cada caso dice
 * que paso y que puede hacer; el resto de la app no se ve afectado.
 */
export function assistantErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) {
    return 'No hay conexión con el servidor. Revisá tu internet y volvé a intentar.';
  }
  if (error.status === 403) {
    return 'No tenés permiso para hacer eso. Si lo necesitás, pedile acceso a quien administra el proyecto.';
  }
  if (error.status === 400 || error.status === 404) {
    return 'No pude encontrar lo que pediste. Revisá el nombre del proyecto o la tarea y probá de nuevo.';
  }
  if (error.status === 429) {
    return 'Hay muchas consultas al mismo tiempo. Esperá unos segundos y probá de nuevo.';
  }
  if (error.status === 502 || error.status === 503 || error.status === 504) {
    return 'El asistente no está disponible en este momento. El resto de la aplicación sigue funcionando, probá de nuevo más tarde.';
  }
  return 'Algo salió mal al procesar tu consulta. Probá de nuevo en un momento.';
}
