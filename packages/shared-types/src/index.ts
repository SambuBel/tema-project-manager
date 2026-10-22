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
  /** ISO. Ya viaja en la respuesta de GET /users (es la entidad completa). */
  createdAt: string;
}

export interface ListUsersQuery {
  /** Incluye también a los usuarios desactivados (la pantalla de administración los necesita; el resto, no). */
  includeInactive?: boolean;
  search?: string;
  /** Filtra a quienes tengan ese rol global — ej. candidatos para liderar un proyecto. */
  role?: RoleName;
}

/** POST /auth/login. */
export interface LoginDto {
  email: string;
  password: string;
}

/** POST /users (solo ADMIN). La contraseña la hashea el backend; nunca se devuelve. */
export interface CreateUserDto {
  email: string;
  name: string;
  password: string;
  /** Roles globales iniciales. Si se omite: ['COLLABORATOR']. */
  roles?: RoleName[];
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
  slug: string;
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
  /** Líder del proyecto. Omitido = el propio usuario, solo si tiene PROJECT_LEADER; ADMIN/PM sin ese rol deben enviarlo. */
  leaderId?: ID;
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
  name?: string | null;
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
  name?: string;
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
  slug?: string;
  projectId: ID;
  milestoneId?: ID | null;
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
  subtaskCount?: number;
  completedSubtaskCount?: number;
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

// --- Gantt (GET /projects/:projectId/gantt) -------------------------------------------------
export type GanttDependencyType = 'FINISH_TO_START';

export interface GanttProject {
  id: ID;
  name: string;
  startDate: string | null;
  estimatedEndDate: string | null;
}

export interface GanttAssignee {
  id: ID;
  name: string;
}

export interface GanttTask {
  id: ID;
  parentTaskId: ID | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  assignedTo: GanttAssignee | null;
  blocked: boolean;
}

export interface GanttDependency {
  id: ID;
  predecessorTaskId: ID;
  successorTaskId: ID;
  type: GanttDependencyType;
}

export interface GanttResponse {
  project: GanttProject;
  tasks: GanttTask[];
  dependencies: GanttDependency[];
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
// --- Presupuesto (POST/GET /projects/:projectId/budget) ---------------------------------------
// Datos económicos: solo los reciben ADMIN, PROGRAM_MANAGER y (GET) el líder real del proyecto.

/** Alta del presupuesto inicial. `version`, `isCurrent` y `createdBy` los fija el servidor. */
export interface CreateBudgetDto {
  /** Importe como STRING (nunca number: sin floating point), hasta 12 enteros y 2 decimales, >= 0. */
  totalAmount: string;
  /** 3 letras mayúsculas (formato ISO 4217). Todavía sin catálogo de monedas habilitadas. */
  currency: string;
  /** YYYY-MM-DD */
  approvalDate: string;
}

/** Nueva versión del presupuesto. `expectedVersion` = versión vigente que el usuario vio (control optimista, RNF-20). */
export interface CreateBudgetVersionDto extends CreateBudgetDto {
  expectedVersion: number;
}

export interface Budget {
  id: ID;
  projectId: ID;
  version: number;
  /** String con 2 decimales, ej. "1500000.50". */
  totalAmount: string;
  currency: string;
  /** YYYY-MM-DD */
  approvalDate: string;
  isCurrent: boolean;
  supersededAt: string | null;
  createdBy: ID;
  createdAt: string;
}
// --- Milestones (Hitos) --------------------------------------------------------
export type MilestoneStatus = 'PENDING' | 'OVERDUE' | 'COMPLETED';

export interface Milestone {
  id: ID;
  projectId: ID;
  name: string;
  description: string | null;
  dueDate: string;
  completedAt: string | null;
  completedById: ID | null;
  completedBy?: User | null;
  createdBy: ID;
  creator?: User;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  progress?: number;
  taskCount?: number;
  completedTaskCount?: number;
}
export interface MilestoneUser {
  id: ID;
  name: string;
  email?: string;
  avatarUrl?: string | null;
}

export interface MilestoneSummary {
  id: ID;
  projectId: ID;
  name: string;
  description: string | null;
  dueDate: string;
  completedAt: string | null;
  completedById: ID | null;
  completedBy?: MilestoneUser | null;
  createdBy: ID;
  creator?: MilestoneUser;
  createdAt: string;
  updatedAt: string;
  status: MilestoneStatus;
  taskCount: number;
  completedTaskCount: number;
  progress: number;
}

export interface MilestoneTask {
  id: ID;
  title: string;
  slug?: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  parentTaskId: string | null;
  assignedTo: MilestoneUser | null;
}

export interface MilestoneDetail extends MilestoneSummary {
  tasks: MilestoneTask[];
}

export type MilestoneSummaryDto = MilestoneSummary;
export type MilestoneDetailDto = MilestoneDetail;
export type MilestoneTaskDto = MilestoneTask;
export type MilestoneUserDto = MilestoneUser;

export interface CreateMilestoneDto {
  name: string;
  dueDate: string;
  description?: string;
}

export interface UpdateMilestoneDto {
  name?: string;
  dueDate?: string;
  description?: string;
}
