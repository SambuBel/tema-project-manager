/** Espejo de los tipos del backend (apps/backend/src/notifications). */
export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'COMMENT_MENTION'
  | 'TASK_COMMENTED'
  | 'TASK_DUE_SOON'
  | 'BUDGET_THRESHOLD'
  | 'PROJECT_RED_ALERT';

export interface AppNotification {
  id: string;
  type: NotificationType | string;
  title: string;
  message: string;
  projectId: string | null;
  taskId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsPage {
  items: AppNotification[];
  total: number;
  unreadCount: number;
}

export interface NotificationPreference {
  type: NotificationType;
  enabled: boolean;
}

export interface ListNotificationsQuery {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

/** Texto y descripción de cada tipo para el panel de preferencias (RF-NO-04). */
export const NOTIFICATION_TYPE_INFO: Record<NotificationType, { label: string; description: string }> = {
  TASK_ASSIGNED: { label: 'Asignación de tareas', description: 'Cuando te asignan una tarea.' },
  COMMENT_MENTION: { label: 'Menciones', description: 'Cuando te mencionan con @ en un comentario.' },
  TASK_COMMENTED: { label: 'Comentarios en tus tareas', description: 'Cuando comentan una tarea tuya.' },
  TASK_DUE_SOON: { label: 'Tareas por vencer', description: 'Cuando una tarea tuya está próxima a vencer.' },
  BUDGET_THRESHOLD: {
    label: 'Ejecución presupuestaria',
    description: 'Cuando un proyecto supera un umbral de ejecución (Líder y Program Manager).',
  },
  PROJECT_RED_ALERT: {
    label: 'Proyecto en desvío rojo',
    description: 'Cuando un proyecto entra en desvío rojo (Líder y Program Manager).',
  },
};