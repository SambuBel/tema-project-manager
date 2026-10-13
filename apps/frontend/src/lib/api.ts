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
  Subtask,
  CreateSubtaskDto,
  UpdateSubtaskDto,
  GanttResponse,
  LoginDto,
  CreateUserDto,
} from '@tema/shared-types';
import type { Task, TaskFilters, TaskStatus, TaskTimelineItem } from '../types/task'

const BASE = '/api';

/** Turno previo del chat del asistente (el backend no guarda la conversacion). */
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Error de la API. `message` sigue siendo "<status> <statusText>" (como siempre); `details`
 * trae los mensajes que mando el backend (ej. validaciones) para poder mostrarselos al usuario.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly details: string[];
  /** `code` y datos extra de errores de dominio estructurados (ej. USER_LEADS_PROJECTS), si el backend los manda. */
  readonly code?: string;
  readonly data?: Record<string, unknown>;

  constructor(status: number, statusText: string, details: string[] = [], code?: string, data?: Record<string, unknown>) {
    super(`${status} ${statusText}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.details = details;
    this.code = code;
    this.data = data;
  }
}

interface ErrorBody {
  details: string[];
  code?: string;
  data?: Record<string, unknown>;
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  try {
    const { message, code, ...rest } = (await res.json()) as { message?: unknown; code?: unknown } & Record<string, unknown>;
    const details = Array.isArray(message)
      ? message.filter((m): m is string => typeof m === 'string')
      : typeof message === 'string'
        ? [message]
        : [];
    return { details, code: typeof code === 'string' ? code : undefined, data: rest };
  } catch {
    return { details: [] };
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
  if (res.status === 401 && path !== '/auth/me' && path !== '/auth/login' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }

  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new ApiRequestError(res.status, res.statusText, body.details, body.code, body.data);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

async function downloadFile(path: string, defaultFilename: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
  })

  if (res.status === 401 && window.location.pathname !== '/login') {
    window.location.href = '/login';
    return;
  }

  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new ApiRequestError(res.status, res.statusText, body.details, body.code, body.data)
  }

  const blob = await res.blob()

  // Esto intenta sacar el nombre del Content-Disposition del back
  const disposition = res.headers.get('Content-Disposition');
  let filename = defaultFilename;
  if (disposition) {
    const match = disposition.match(/filename="?([^";\s]+)"?/);
    if (match?.[1]) filename = match[1]
  }

  // Crea enlace temporal para disparar la descarga
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url)

}

export const api = {
  getMe: () => request<AuthenticatedUser>('/auth/me'),
  /** Email + contraseña: el backend emite la misma cookie de sesión que Google. 401 = credenciales incorrectas. */
  login: (dto: LoginDto) => request<AuthenticatedUser>('/auth/login', { method: 'POST', body: JSON.stringify(dto) }),
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
  getGantt: (projectId: string) => request<GanttResponse>(`/projects/${projectId}/gantt`),
  getProjectMembers: (id: string) => request<ProjectMember[]>(`/projects/${id}/members`),
  getAvailableUsers: (id: string, search?: string) =>
    request<UserWithRoles[]>(`/projects/${id}/available-users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
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
    if (query?.includeInactive) params.append('includeInactive', 'true');
    const qs = params.toString();
    return request<UserWithRoles[]>(`/users${qs ? `?${qs}` : ''}`);
  },
  /** Alta de usuario (solo ADMIN). Se manda `password` en claro por HTTPS: el backend la hashea; nunca existe passwordHash acá. */
  createUser: (dto: CreateUserDto) =>
    request<UserWithRoles>('/users', { method: 'POST', body: JSON.stringify(dto) }),
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
  createSubtask: (taskId: string, dto: CreateSubtaskDto) =>
    request<Subtask>(`/tasks/${taskId}/subtasks` , { method: 'POST', body: JSON.stringify(dto)}),
  updateSubtask: (taskId: string, subtaskId: string, dto: UpdateSubtaskDto) =>
    request<Subtask>(`/tasks/${taskId}/subtasks/${subtaskId}` , { method: 'PATCH', body: JSON.stringify(dto)}),
  deleteSubtask: (taskId: string, subtaskId: string) =>
    request<void>(`/tasks/${taskId}/subtasks/${subtaskId}` , { method: 'DELETE' }),
  getTaskTimeline: (taskId: string) => request<TaskTimelineItem[]>(`/tasks/${taskId}/timeline`),
  addTaskComment: (taskId: string, content: string) => request<TaskTimelineItem>(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ content }) }),

  // --- Asistente ---
  sendChatMessage: (message: string, projectId?: string, history: ChatTurn[] = []) =>
    request<{ reply: string }>('/ai/chat', { method: 'POST', body: JSON.stringify({ message, projectId, history }) }),
  getAssistantStatus: () => request<{ mode: 'gemini' | 'rules' }>('/ai/status'),

  // --- Exportaciones ---
  exportTasksCsv: (projectId: string, filters?: TaskFilters) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.assignedToId) params.append('assignedToId', filters.assignedToId);
    if (filters?.search) params.append('search', filters.search);
    const qs = params.toString();
    return downloadFile(`/projects/${projectId}/export/tasks${qs ? `?${qs}` : ''}`, 'tareas.csv')
  },
  exportStatusHistoryCsv: (projectId: string) => 
    downloadFile(`/projects/${projectId}/export/status-history`, 'historial-estados.csv'),
};
