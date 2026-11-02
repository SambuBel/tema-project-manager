/**
 * Catálogo de tipos de notificación (columna notifications.type, varchar libre).
 * Uno por evento definido por TEMA: RF-NO-01, RF-NO-02, RF-CO-02, RF-CT-11 y los casos de uso CU-01 y CU-06.
 */
export enum NotificationType {
  /** RF-NO-01: te asignaron una tarea. */
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  /** RF-CO-02: te mencionaron con @ en un comentario. */
  COMMENT_MENTION = 'COMMENT_MENTION',
  /** RF-NO-01: comentaron una tarea tuya. */
  TASK_COMMENTED = 'TASK_COMMENTED',
  /** RF-NO-01: una tarea tuya está por vencer. */
  TASK_DUE_SOON = 'TASK_DUE_SOON',
  /** RF-NO-02 / RF-CT-11: el proyecto superó un umbral de ejecución presupuestaria. */
  BUDGET_THRESHOLD = 'BUDGET_THRESHOLD',
  /** RF-NO-02: el proyecto entró en desvío rojo. */
  PROJECT_RED_ALERT = 'PROJECT_RED_ALERT',
  /** CU-01: te agregaron a un proyecto. */
  PROJECT_MEMBER_ADDED = 'PROJECT_MEMBER_ADDED',
  /** CU-06: cambió el estado de una tarea de un proyecto que liderás. */
  TASK_STATUS_CHANGED = 'TASK_STATUS_CHANGED',
}