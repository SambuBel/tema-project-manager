import type { 
  CreateProjectDto, 
  Project, 
  ListProjectsQuery, 
  UpdateProjectStatusDto,
  ProjectMember,
  AddProjectMemberDto,
  UpdateProjectMemberRoleDto,
  AuthenticatedUser
} from '@tema/shared-types';
import type { Task, TaskFilters } from '../types/task'

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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


listTasks: (filters: TaskFilters) => {
  const params = new URLSearchParams();
  params.append('projectId', filters.projectId);
  if (filters.status) params.append('status', filters.status);
  if (filters.priority) params.append('priority', filters.priority);
  if (filters.assignedToId) params.append('assignedToId', filters.assignedToId);
  if (filters.search) params.append('search', filters.search);
  return request<Task[]>(`/tasks?${params.toString()}`);
},
getTask: (id: string) => request<Task>(`/tasks/${id}`),
};
