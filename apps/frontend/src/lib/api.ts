import type { CreateProjectDto, Project, ListProjectsQuery, UpdateProjectStatusDto } from '@tema/shared-types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  listProjects: (query?: ListProjectsQuery) => {
    const params = new URLSearchParams();
    if (query?.name) params.append('name', query.name);
    if (query?.status) params.append('status', query.status);
    const qs = params.toString();
    return request<Project[]>(`/projects${qs ? `?${qs}` : ''}`);
  },
  createProject: (dto: CreateProjectDto) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(dto) }),
  updateProjectStatus: (id: string, dto: UpdateProjectStatusDto) =>
    request<Project>(`/projects/${id}/status`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
};
