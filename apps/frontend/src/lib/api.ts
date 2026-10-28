  getMemberResourceAllocationHistory: (projectId: string, memberId: string) =>
    request<MemberResourceAllocationHistoryEntry[]>(`/projects/${projectId}/members/${memberId}/resource-allocation/history`),

  // --- Costos incurridos (sin DELETE: no hay endpoint aprobado) ---
  listProjectCosts: (projectId: string, query: { page: number; limit: number }) =>
    request<PaginatedResponse<Cost>>(`/projects/${projectId}/costs?page=${query.page}&limit=${query.limit}`),
  getProjectCost: (projectId: string, costId: string) => request<Cost>(`/projects/${projectId}/costs/${costId}`),
  createProjectCost: (projectId: string, dto: CreateCostDto) =>
    request<Cost>(`/projects/${projectId}/costs`, { method: 'POST', body: JSON.stringify(dto) }),
  updateProjectCost: (projectId: string, costId: string, dto: UpdateCostDto) =>
    request<Cost>(`/projects/${projectId}/costs/${costId}`, { method: 'PATCH', body: JSON.stringify(dto) }),

  // --- Milestones ---
  listMilestones: (projectId: string, query?: { upcoming?: boolean; limit?: number }) => {
    const params = new URLSearchParams();
    if (query?.upcoming !== undefined) params.append('upcoming', String(query.upcoming));
    if (query?.limit !== undefined) params.append('limit', String(query.limit));
    const qs = params.toString();
    return request<MilestoneSummaryDto[]>(`/projects/${projectId}/milestones${qs ? `?${qs}` : ''}`);
  },
  getMilestone: (id: string) => request<MilestoneDetailDto>(`/milestones/${id}`),
  createMilestone: (projectId: string, dto: CreateMilestoneDto) =>
    request<MilestoneSummaryDto>(`/projects/${projectId}/milestones`, { method: 'POST', body: JSON.stringify(dto) }),
  updateMilestone: (id: string, dto: UpdateMilestoneDto) =>
    request<MilestoneSummaryDto>(`/milestones/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteMilestone: (id: string) => request<void>(`/milestones/${id}`, { method: 'DELETE' }),
  completeMilestone: (id: string) => request<MilestoneSummaryDto>(`/milestones/${id}/complete`, { method: 'PATCH' }),
  completeMilestoneWithTasks: (id: string) => request<MilestoneSummaryDto>(`/milestones/${id}/complete-with-tasks`, { method: 'PATCH' }),
  reopenMilestone: (id: string) => request<MilestoneSummaryDto>(`/milestones/${id}/reopen`, { method: 'PATCH' }),
  associateMilestoneTask: (milestoneId: string, taskId: string) =>
    request<MilestoneSummaryDto>(`/milestones/${milestoneId}/tasks/${taskId}`, { method: 'PUT' }),
  disassociateMilestoneTask: (milestoneId: string, taskId: string) =>
    request<MilestoneSummaryDto>(`/milestones/${milestoneId}/tasks/${taskId}`, { method: 'DELETE' }),

  // --- Tasks ---
  listTasks: (filters: TaskFilters) => {
    const params = new URLSearchParams();
    params.append('projectId', filters.projectId);
    if (filters.status) params.append('status', filters.status);
    if (filters.priority) params.append('priority', filters.priority);
    if (filters.assignedToId) params.append('assignedToId', filters.assignedToId);
    if (filters.search) params.append('search', filters.search);
    if (filters.page) params.append('page', String(filters.page));
    if (filters.limit) params.append('limit', String(filters.limit));
    if (filters.myTasks) params.append('myTasks', 'true');
    if (filters.atRisk) params.append('atRisk', 'true');
    if (filters.includeSubtasks) params.append('includeSubtasks', 'true');
    return request<TaskListResponse>(`/tasks?${params.toString()}`);
  },
  listAllTasks: async (filters: TaskFilters): Promise<Task[]> => {
    const first = await api.listTasks({ ...filters, page: 1, limit: 100 });
    const tasks = [...first.data];
    for (let page = 2; page <= first.totalPages; page++) {
      const next = await api.listTasks({ ...filters, page, limit: 100 });
      tasks.push(...next.data);
    }
    return tasks;
  },
  createTask: (dto: CreateTaskDto) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(dto) }),
  getTask: (idOrSlug: string, projectId?: string) =>
    request<Task>(`/tasks/${encodeURIComponent(idOrSlug)}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
  updateTask: (id: string, dto: UpdateTaskDto) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  updateTaskStatus: (id: string, status: TaskStatus, options?: { completeSubtasks?: boolean }) =>
    request<Task>(`/tasks/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(options?.completeSubtasks ? { status, completeSubtasks: true } : { status }),
    }),
  archiveTask: (id: string) =>
    request<Task>(`/tasks/${id}/archive`, { method: 'PATCH' }),
  getSubtasks: (taskId: string) => request<Task[]>(`/tasks/${taskId}/subtasks`),
  createSubtask: (taskId: string, dto: CreateSubtaskDto) =>
    request<Subtask>(`/tasks/${taskId}/subtasks` , { method: 'POST', body: JSON.stringify(dto)}),
  updateSubtask: (taskId: string, subtaskId: string, dto: UpdateSubtaskDto) =>
    request<Subtask>(`/tasks/${taskId}/subtasks/${subtaskId}` , { method: 'PATCH', body: JSON.stringify(dto)}),
  deleteSubtask: (taskId: string, subtaskId: string) =>
    request<void>(`/tasks/${taskId}/subtasks/${subtaskId}` , { method: 'DELETE' }),
  getTaskTimeline: (taskId: string, page = 1, limit = 10) => request<PaginatedResponse<TaskTimelineItem>>(`/tasks/${taskId}/timeline?page=${page}&limit=${limit}`),
  addTaskComment: (taskId: string, content: string, mentions?: CommentMention[]) =>
    request<TaskTimelineItem>(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ content, mentions }) }),
  updateTaskComment: (taskId: string, commentId: string, content: string, mentions?: CommentMention[]) =>
    request<TaskTimelineItem>(`/tasks/${taskId}/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify({ content, mentions }) }),
  deleteTaskComment: (taskId: string, commentId: string) =>
    request<{ success: boolean }>(`/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' }),

  // --- Asistente ---
  sendChatMessage: (message: string, projectId?: string, history: ChatTurn[] = []) =>
    request<{ reply: string }>('/ai/chat', { method: 'POST', body: JSON.stringify({ message, projectId, history }) }),
  getAssistantStatus: () => request<{ mode: 'gemini' | 'rules' }>('/ai/status'),

   // --- Exportaciones ---
  exportTasksCsv: (projectId: string, filters?: TaskFilters) => {
    const params = new URLSearchParams();

    if (filters?.status) params.append('status', filters.status);
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.assignedToId) {
      params.append('assignedToId', filters.assignedToId);
    }
    if (filters?.search) params.append('search', filters.search);

    const qs = params.toString();

    return downloadFile(
      `/projects/${projectId}/export/tasks${qs ? `?${qs}` : ''}`,
      'tareas.csv',
    );
  },

  exportStatusHistoryCsv: (projectId: string) =>
    downloadFile(
      `/projects/${projectId}/export/status-history`,
      'historial-estados.csv',
    ),

  exportEconomicReportCsv: (projectId: string) =>
    downloadFile(
      `/projects/${projectId}/export/economic-report`,
      'reporte-economico.csv',
    ),

  exportPortfolioCsv: () =>
    downloadFile('/projects/export/portfolio', 'portafolio.csv'),
};