/**
 * Catálogo de tipos de notificación (columna notifications.type, varchar libre).
 * Uno por evento definido por TEMA: RF-NO-01, RF-NO-02, RF-CO-02 y RF-CT-11.
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
}