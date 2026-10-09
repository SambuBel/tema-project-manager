import type {
  CreateProjectDto,
  Project,
  ListProjectsQuery,
  UpdateProjectStatusDto,
  UpdateProjectDto,
  ProjectMember,
  ProjectInvitation,
  AddProjectMemberDto,
  InviteProjectMemberDto,
  UpdateProjectMemberRoleDto,
  ChangeProjectLeaderDto,
  AuthenticatedUser,
  CreateTaskDto,
  UpdateTaskDto,
  UserWithRoles,
  ListUsersQuery,
  RoleName,
} from '@tema/shared-types';
import type { Task, TaskFilters, TaskStatus, TaskTimelineItem } from '../types/task'

const BASE = '/api';

/**
 * Error de la API. `message` sigue siendo "<status> <statusText>" (como siempre); `details`
 * trae los mensajes que mando el backend (ej. validaciones) para poder mostrarselos al usuario.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(status: number, statusText: string, details: string[] = []) {
    super(`${status} ${statusText}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.details = details;
  }
}

async function readErrorDetails(res: Response): Promise<string[]> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (Array.isArray(body.message)) return body.message.filter((m): m is string => typeof m === 'string');
    return typeof body.message === 'string' ? [body.message] : [];
  } catch {
    return [];
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...init,
  });

  // Sesión cortada a mitad de uso (cookie vencida/inválida en cualquier llamada
  // que no sea la propia /auth/me, que ya maneja useCurrentUser + RequireAuth
  // sin necesitar un reload duro). Reload completo, no navigate(): así se
  // descarta cualquier estado en memoria de una sesión que ya no es válida.
  if (res.status === 401 && path !== '/auth/me' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }

  if (!res.ok) throw new ApiRequestError(res.status, res.statusText, await readErrorDetails(res));
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  getMe: () => request<AuthenticatedUser>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  listProjects: (query?: ListProjectsQuery) => {
    const params = new URLSearchParams();
    if (query?.name) params.append('name', query.name);
    if (query?.status) params.append('status', query.status);
    if (query?.archived !== undefined) params.append('archived', String(query.archived));
    const qs = params.toString();
    return request<Project[]>(`/projects${qs ? `?${qs}` : ''}`);
  },
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  getProjectActivity: (id: string, limit = 50, offset = 0) =>
    request<any[]>(`/projects/${id}/activity?limit=${limit}&offset=${offset}`),
  createProject: (dto: CreateProjectDto) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(dto) }),
  updateProject: (id: string, dto: UpdateProjectDto) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  updateProjectStatus: (id: string, dto: UpdateProjectStatusDto) =>
    request<Project>(`/projects/${id}/status`, { method: 'PATCH', body: JSON.stringify(dto) }),
  archiveProject: (id: string) =>
    request<Project>(`/projects/${id}/archive`, { method: 'PATCH' }),
  getProjectMembers: (id: string) => request<ProjectMember[]>(`/projects/${id}/members`),
  getProjectInvitations: (id: string) => request<ProjectInvitation[]>(`/projects/${id}/invitations`),
  addProjectMember: (id: string, dto: AddProjectMemberDto) =>
    request<ProjectMember>(`/projects/${id}/members`, { method: 'POST', body: JSON.stringify(dto) }),
  inviteProjectMember: (id: string, dto: InviteProjectMemberDto) =>
    request<ProjectInvitation>(`/projects/${id}/invitations`, { method: 'POST', body: JSON.stringify(dto) }),
  testAcceptProjectInvitation: (projectId: string, invitationId: string) =>
    request<void>(`/projects/${projectId}/invitations/${invitationId}/test-accept`, { method: 'POST' }),
  revokeProjectInvitation: (projectId: string, invitationId: string) =>
    request<void>(`/projects/${projectId}/invitations/${invitationId}`, { method: 'DELETE' }),
  updateProjectMemberRole: (projectId: string, memberId: string, dto: UpdateProjectMemberRoleDto) =>
    request<ProjectMember>(`/projects/${projectId}/members/${memberId}/role`, { method: 'PATCH', body: JSON.stringify(dto) }),
  removeProjectMember: (projectId: string, memberId: string) =>
    request<void>(`/projects/${projectId}/members/${memberId}`, { method: 'DELETE' }),
  changeProjectLeader: (projectId: string, dto: ChangeProjectLeaderDto) =>
    request<Project>(`/projects/${projectId}/leader`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),

  // --- Users (administración de roles globales) ---
  listUsers: (query?: ListUsersQuery) => {
    const params = new URLSearchParams();
    if (query?.search) params.append('search', query.search);
    if (query?.role) params.append('role', query.role);
    const qs = params.toString();
    return request<UserWithRoles[]>(`/users${qs ? `?${qs}` : ''}`);
  },
  getUser: (id: string) => request<UserWithRoles>(`/users/${id}`),
  updateUserStatus: (id: string, active: boolean) =>
    request<UserWithRoles>(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  assignUserRole: (id: string, role: RoleName) =>
    request<UserWithRoles>(`/users/${id}/roles`, { method: 'POST', body: JSON.stringify({ role }) }),
  removeUserRole: (id: string, role: RoleName) =>
    request<UserWithRoles>(`/users/${id}/roles/${role}`, { method: 'DELETE' }),

  // --- Tasks ---
  listTasks: (filters: TaskFilters) => {
    const params = new URLSearchParams();
    params.append('projectId', filters.projectId);
    if (filters.status) params.append('status', filters.status);
    if (filters.priority) params.append('priority', filters.priority);
    if (filters.assignedToId) params.append('assignedToId', filters.assignedToId);
    if (filters.search) params.append('search', filters.search);
    return request<Task[]>(`/tasks?${params.toString()}`);
  },
  createTask: (dto: CreateTaskDto) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(dto) }),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  updateTask: (id: string, dto: UpdateTaskDto) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  updateTaskStatus: (id: string, status: TaskStatus) =>
    request<Task>(`/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  archiveTask: (id: string) =>
    request<Task>(`/tasks/${id}/archive`, { method: 'PATCH' }),
  getSubtasks: (taskId: string) => request<Task[]>(`/tasks/${taskId}/subtasks`),
  getTaskTimeline: (taskId: string) => request<TaskTimelineItem[]>(`/tasks/${taskId}/timeline`),
  addTaskComment: (taskId: string, content: string) => request<TaskTimelineItem>(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ content }) }),

  // --- Asistente ---
  sendChatMessage: (message: string, projectId?: string) =>
    request<{ reply: string }>('/ai/chat', { method: 'POST', body: JSON.stringify({ message, projectId }) }),
};
