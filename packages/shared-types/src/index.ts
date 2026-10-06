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

/** Usuario + sus roles globales, para la administración de usuarios (GET /users, GET /users/:id). */
export interface UserWithRoles {
  id: ID;
  email: string;
  name: string;
  avatarUrl: string | null;
  active: boolean;
  roles: RoleName[];
}

export interface ListUsersQuery {
  search?: string;
  /** Filtra a quienes tengan ese rol global — ej. candidatos para liderar un proyecto. */
  role?: RoleName;
}

export interface UpdateUserStatusDto {
  active: boolean;
}

/** Asignar/quitar un rol global. Ver RN-09: nadie puede modificar sus propios roles. */
export interface AssignRoleDto {
  role: RoleName;
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
  memberCount?: number;
  progress?: number;
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

/** Rol de un usuario DENTRO de un proyecto puntual. Nunca incluye PROJECT_LEADER: el líder es project.leaderId. */
export type ProjectMemberRole = 'COLLABORATOR' | 'OBSERVER';

export interface ProjectMember {
  id: ID;
  projectId: ID;
  userId: ID;
  user?: User;
  projectRole: ProjectMemberRole;
  joinedAt: string;
}

export interface ProjectInvitation {
  id: ID;
  projectId: ID;
  email: string;
  projectRole: ProjectMemberRole;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
  createdAt: string;
}

export interface AddProjectMemberDto {
  userId: ID;
  projectRole: ProjectMemberRole;
}

export interface InviteProjectMemberDto {
  email: string;
  projectRole: ProjectMemberRole;
}

export interface UpdateProjectMemberRoleDto {
  projectRole: ProjectMemberRole;
}

export interface UpdateProjectStatusDto {
  status: ProjectStatus;
}

/** Solo ADMIN/PROGRAM_MANAGER. El nuevo líder debe existir, estar activo y tener RoleName.PROJECT_LEADER. */
export interface ChangeProjectLeaderDto {
  newLeaderId: ID;
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

export type TaskStatus = 'PENDING' | 'BLOCKED' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Task {
  id: ID;
  projectId: ID;
  parentTaskId: ID | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedToId: ID | null;
  assignedTo?: User;
  startDate: string | null;
  dueDate: string | null;
  createdBy: ID;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CreateTaskDto {
  projectId: ID;
  /** Si viene, esta tarea se crea como subtarea de parentTaskId (mismo proyecto, un solo nivel). */
  parentTaskId?: ID;
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

export interface UpdateTaskStatusDto {
  status: TaskStatus;
}

export interface Subtask {
  id: ID;
  taskId: ID;
  title: string;
  assignedToId: ID | null;
  assignedTo?: User;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubtaskDto {
  title: string;
  assignedToId?: ID;
}

export interface UpdateSubtaskDto {
  title?: string;
  assignedToId?: ID | null;
  completed?: boolean;
}