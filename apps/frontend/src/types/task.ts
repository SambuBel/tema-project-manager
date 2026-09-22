/**
 * Cuando se agreguen a @tema/shared-types, reemplazar estos imports.
 */

export type TaskStatus = 'PENDING' | 'BLOCKED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedToId: string | null;
  assignedTo: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  project: {
    id: string;
    name: string;
  };
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFilters {
  projectId: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedToId?: string;
  search?: string;
}

/** Labels para mostrar en la UI. */
export const taskStatusLabels: Record<TaskStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  BLOCKED: 'Bloqueada',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

export const taskPriorityLabels: Record<TaskPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
};