/**
 * Tipos de tareas sincronizados con @tema/shared-types.
 * Cuando se migre completamente a shared-types, reemplazar estos imports.
 */
import type { User } from '@tema/shared-types';

export type TaskStatus = 'PENDING' | 'BLOCKED' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedToId: string | null;
  assignedTo?: User;
  project: {
    id: string;
    name: string;
    leaderId: string;
  };
  /** Quién creó la tarea (siempre presente, el backend lo llena con el usuario autenticado). */
  startDate: string | null;
  dueDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface TaskFilters {
  projectId: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedToId?: string;
  search?: string;
}

export const taskStatusLabels: Record<TaskStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  IN_REVIEW: 'En revisión',
  BLOCKED: 'Bloqueada',
  COMPLETED: 'Completada'
};

export const taskPriorityLabels: Record<TaskPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica'
};


/* En caso de cambiar algo acá, cambiar el backend también task-transitions.ts */
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ['IN_PROGRESS', 'BLOCKED'],
  IN_PROGRESS: ['IN_REVIEW', 'BLOCKED', 'COMPLETED'],
  IN_REVIEW: ['COMPLETED', 'IN_PROGRESS'],
  BLOCKED: ['PENDING'],
  COMPLETED: []
};

export interface TaskTimelineItem {
  id: string;
  type: 'COMMENT' | 'HISTORY';
  content?: string;
  actionType?: string;
  metadata?: any;
  actor: {
    id: string;
    name: string;
    avatar: string;
  };
  createdAt: string;
}
