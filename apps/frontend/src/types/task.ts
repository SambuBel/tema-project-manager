/**
 * Tipos de tareas sincronizados con @tema/shared-types.
 * Cuando se migre completamente a shared-types, reemplazar estos imports.
 */
import type { User, PaginatedResponse } from '@tema/shared-types';

export type TaskStatus = 'PENDING' | 'BLOCKED' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Task {
  id: string;
  slug?: string;
  projectId: string;
  parentTaskId: string | null;
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
    startDate?: string | null;
    estimatedEndDate?: string | null;
  };
  /** Quién creó la tarea (siempre presente, el backend lo llena con el usuario autenticado). */
  startDate: string | null;
  dueDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  subtaskCount?: number;
  completedSubtaskCount?: number;
}

export interface TaskFilters {
  projectId: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedToId?: string;
  search?: string;
  page?: number;
  limit?: number;
  myTasks?: boolean;
  atRisk?: boolean;
  includeSubtasks?: boolean;
}

export interface TaskListResponse extends PaginatedResponse<Task> {
  counts: { all: number; mine: number; atRisk: number };
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


const ALL_STATUSES: TaskStatus[] = ['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];

/* En caso de cambiar algo acá, cambiar el backend también task-transitions.ts */
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING:     ALL_STATUSES.filter((s) => s !== 'PENDING'),
  IN_PROGRESS: ALL_STATUSES.filter((s) => s !== 'IN_PROGRESS'),
  IN_REVIEW:   ALL_STATUSES.filter((s) => s !== 'IN_REVIEW'),
  BLOCKED:     ALL_STATUSES.filter((s) => s !== 'BLOCKED'),
  COMPLETED:   ALL_STATUSES.filter((s) => s !== 'COMPLETED'),
};

export interface CommentMention {
  userId: string;
  name: string;
  startIndex: number;
  endIndex: number;
}

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
  editedAt?: string | null;
  mentions?: CommentMention[];
}

export interface CommentMention {
  userId: string;
  name: string;
  startIndex: number;
  endIndex: number;
}
