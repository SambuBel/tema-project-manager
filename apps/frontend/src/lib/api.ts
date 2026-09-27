import type { 
  CreateProjectDto, 
  Project, 
  ListProjectsQuery, 
  UpdateProjectStatusDto,
  UpdateProjectDto,
  ProjectMember,
  AddProjectMemberDto,
  UpdateProjectMemberRoleDto,
  AuthenticatedUser,
  CreateTaskDto,
  Task
} from '@tema/shared-types';

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
  if (!res.ok) throw new ApiRequestError(res.status, res.statusText, await readErrorDetails(res));
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  getMe: () => request<AuthenticatedUser>('/auth/me'),
  listProjects: (query?: ListProjectsQuery) => {
    const params = new URLSearchParams();
    if (query?.name) params.append('name', query.name);
    if (query?.status) params.append('status', query.status);
    if (query?.archived !== undefined) params.append('archived', String(query.archived));
    const qs = params.toString();
    return request<Project[]>(`/projects${qs ? `?${qs}` : ''}`);
  },
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (dto: CreateProjectDto) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(dto) }),
  updateProject: (id: string, dto: UpdateProjectDto) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  updateProjectStatus: (id: string, dto: UpdateProjectStatusDto) =>
    request<Project>(`/projects/${id}/status`, { method: 'PATCH', body: JSON.stringify(dto) }),
  archiveProject: (id: string) => 
    request<Project>(`/projects/${id}/archive`, { method: 'PATCH' }),
  getProjectMembers: (id: string) => request<ProjectMember[]>(`/projects/${id}/members`),
  addProjectMember: (id: string, dto: AddProjectMemberDto) =>
    request<ProjectMember>(`/projects/${id}/members`, { method: 'POST', body: JSON.stringify(dto) }),
  updateProjectMemberRole: (projectId: string, memberId: string, dto: UpdateProjectMemberRoleDto) =>
    request<ProjectMember>(`/projects/${projectId}/members/${memberId}/role`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  createTask: (dto: CreateTaskDto) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(dto) }),
};
