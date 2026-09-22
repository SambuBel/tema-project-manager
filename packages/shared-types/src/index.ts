/**
 * Tipos compartidos entre frontend y backend.
 * Todo lo que viaje por la API deberia estar tipado aca.
 */

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}

export type ID = string;

export type ProjectStatus = 'PLANNED' | 'IN_PROGRESS' | 'PAUSED' | 'FINISHED' | 'CANCELLED';

export interface User {
  id: ID;
  email: string;
  name: string;
  avatarUrl: string | null;
  active: boolean;
}

export type RoleName = 'ADMIN' | 'PROGRAM_MANAGER' | 'PROJECT_LEADER' | 'COLLABORATOR' | 'OBSERVER';

/** Usuario devuelto por GET /auth/me. */
export interface AuthenticatedUser {
  id: ID;
  email: string;
  name: string;
  avatarUrl: string | null;
  roles: RoleName[];
}

export interface Project {
  id: ID;
  name: string;
  description: string | null;
  startDate: string | null;
  estimatedEndDate: string | null;
  status: ProjectStatus;
  leaderId: ID;
  leader?: User;
  createdBy: ID;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CreateProjectDto {
  name: string;
  description?: string;
  startDate?: string;
  estimatedEndDate?: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  startDate?: string;
  estimatedEndDate?: string;
}

export interface ProjectMember {
  id: ID;
  projectId: ID;
  userId: ID;
  user?: User;
  projectRole: string;
  joinedAt: string;
}

export interface AddProjectMemberDto {
  userId: ID;
  projectRole: string;
}

export interface UpdateProjectMemberRoleDto {
  projectRole: string;
}

export interface UpdateProjectStatusDto {
  status: ProjectStatus;
}

export interface ListProjectsQuery {
  name?: string;
  status?: ProjectStatus;
  archived?: boolean;
}

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

export type TaskStatus = 'PENDING' | 'BLOCKED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Task {
  id: ID;
  projectId: ID;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedToId: ID | null;
  assignedTo?: User;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskDto {
  projectId: ID;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedToId?: ID;
  startDate?: string;
  dueDate?: string;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedToId?: ID | null;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface ListTasksQuery {
  projectId: ID;
  status?: TaskStatus;
  assignedToId?: ID;
}