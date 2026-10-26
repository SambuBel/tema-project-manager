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
  /**
   * Moneda ÚNICA de todo lo económico del proyecto (presupuesto, costos y asignaciones). Es información económica (RN-25): solo la
   * reciben ADMIN, PROGRAM_MANAGER y el líder real; para el resto el campo no viene.
   */
  economicCurrency?: string;
  /** true si el proyecto ya tiene presupuesto, costos o asignaciones: la moneda ya no se puede cambiar (409 PROJECT_CURRENCY_IN_USE). Mismo criterio de visibilidad. */
  economicCurrencyLocked?: boolean;
}

export interface CreateProjectDto {
  name: string;
  description?: string;
  startDate?: string;
  estimatedEndDate?: string;
  /** Líder del proyecto. Omitido = el propio usuario, solo si tiene PROJECT_LEADER; ADMIN/PM sin ese rol deben enviarlo. */
  leaderId?: ID;
  /** Moneda única del proyecto (3 letras mayúsculas; la UI ofrece ARS y USD). Omitida = ARS. */
  economicCurrency?: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  startDate?: string;
  estimatedEndDate?: string;
  /** Solo se acepta mientras el proyecto NO tenga datos económicos; si no, 409 PROJECT_CURRENCY_IN_USE. */
  economicCurrency?: string;
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
  completeSubtasks?: boolean;
}

export interface ListTasksQuery {
  projectId: ID;
  status?: TaskStatus;
  assignedToId?: ID;
}

export interface UpdateTaskStatusDto {
  status: TaskStatus;
  completeSubtasks?: boolean;
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
  milestoneId?: ID | null;
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
  milestones?: MilestoneSummary[];
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
// --- Asignación de recursos de un miembro (RES-02) ---------------------------------------------
// TODO es información económica (RN-25): solo ADMIN, PROGRAM_MANAGER y el líder real la ven. NO forma parte de `ProjectMember`
// (que es organizativo y lo ve todo el equipo). Perfil, tarifa y moneda son el SNAPSHOT de la asignación, no el catálogo actual.

/** Asigna perfil y/o horas. `expectedRevision` = revisión vigente (0 si todavía no hay asignación). */
export interface UpdateMemberResourceAllocationDto {
  expectedRevision: number;
  /** UUID = asignar ese perfil (activo); null = quitarlo; omitido = conservar. */
  resourceProfileId?: ID | null;
  /** String (nunca number), >= 0, hasta 6 enteros y 2 decimales; null = quitarlas; omitido = conservar. */
  estimatedHours?: string | null;
}

export interface MemberResourceAllocationProfile {
  id: ID;
  /** Nombre, tarifa y moneda tal como eran al asignar el perfil (snapshot). */
  name: string;
  hourlyCost: string;
  currency: string;
}

export interface MemberResourceAllocationState {
  revision: number;
  resourceProfile: MemberResourceAllocationProfile | null;
  estimatedHours: string | null;
  /** horas × tarifa del snapshot, redondeado HALF-UP a 2 decimales; null si falta el perfil o las horas. */
  estimatedResourceCost: { amount: string; currency: string } | null;
  /** Presupuesto vigente cuando se creó esta revisión (null = no había presupuesto). */
  budgetId: ID | null;
  budgetVersion: number | null;
  createdAt: string;
  changedBy: { id: ID; name: string };
}

export interface MemberResourceAllocation {
  projectMemberId: ID;
  user: { id: ID; name: string };
  /** null = el miembro todavía no tiene asignación. */
  allocation: MemberResourceAllocationState | null;
}

export interface MemberResourceAllocationHistoryEntry {
  revision: number;
  isCurrent: boolean;
  resourceProfileId: ID | null;
  profileNameSnapshot: string | null;
  hourlyCostSnapshot: string | null;
  currencySnapshot: string | null;
  estimatedHours: string | null;
  estimatedCostSnapshot: string | null;
  budgetId: ID | null;
  budgetVersion: number | null;
  changedBy: { id: ID; name: string };
  createdAt: string;
  supersededAt: string | null;
  origin: string;
}

/**
 * Miembros activos con su asignación vigente y los totales por moneda. Con moneda única por proyecto `totalsByCurrency` tiene
 * como máximo UNA línea (se conserva la forma por compatibilidad del contrato). No hay conversión ni FX.
 */
export interface ProjectResourceAllocationSummary {
  members: MemberResourceAllocation[];
  totalsByCurrency: Array<{ currency: string; amount: string }>;
}

// --- Perfiles de recurso (GET/POST/PATCH /resource-profiles) -------------------------------------
// Información económica (costo por hora): solo ADMIN, PROGRAM_MANAGER y PROJECT_LEADER la ven; solo ADMIN la administra (provisional).

/** Perfil del catálogo global. `hourlyCost` es STRING con 2 decimales, en la moneda del perfil. */
export interface ResourceProfile {
  id: ID;
  name: string;
  hourlyCost: string;
  currency: string;
  active: boolean;
  /** Token de concurrencia: empieza en 1 y suma 1 en cada edición. Se reenvía como `expectedRevision`. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Alta: el perfil nace activo y con revision 1. */
export interface CreateResourceProfileDto {
  name: string;
  /** String (nunca number), >= 0, hasta 10 enteros y 2 decimales. */
  hourlyCost: string;
  /** 3 letras mayúsculas (la UI ofrece ARS y USD). El catálogo es global; solo se asigna a proyectos de la misma moneda. */
  currency: string;
}

/** Edición parcial con `expectedRevision` obligatorio (RNF-20). `active` activa o desactiva el perfil. */
export interface UpdateResourceProfileDto {
  expectedRevision: number;
  name?: string;
  hourlyCost?: string;
  currency?: string;
  active?: boolean;
}

// --- Costos incurridos (POST/GET /projects/:projectId/costs) ------------------------------------
// Datos económicos: solo ADMIN, PROGRAM_MANAGER y el líder real del proyecto.

/** Alta de un costo. `projectId` sale de la URL y el creador del usuario autenticado. */
export interface CreateCostDto {
  /** YYYY-MM-DD. Se aceptan fechas futuras. */
  costDate: string;
  /** Importe como STRING (nunca number), >= 0, hasta 12 enteros y 2 decimales. */
  amount: string;
  /**
   * OPCIONAL y desaconsejada: el costo SIEMPRE se registra en la moneda del proyecto (`Project.economicCurrency`), que el backend
   * deriva. Si se envía y es distinta responde 400 PROJECT_CURRENCY_MISMATCH; nunca se convierte.
   */
  currency?: string;
  /** Debe estar activo y tener una partida en el presupuesto VIGENTE del proyecto. */
  costCategoryId: ID;
  /** Obligatoria, hasta 500 caracteres (tope técnico). */
  description: string;
  /** Opcional; debe pertenecer al mismo proyecto. */
  taskId?: ID;
  /** Confirma un costo con fecha anterior al inicio del proyecto (RN-21). */
  confirmBeforeProjectStart?: boolean;
}

export interface Cost {
  id: ID;
  projectId: ID;
  taskId: ID | null;
  taskTitle: string | null;
  costCategoryId: ID;
  categoryName: string;
  /** String con 2 decimales, en su moneda ORIGINAL. */
  amount: string;
  currency: string;
  /** YYYY-MM-DD */
  costDate: string;
  description: string;
  createdBy: ID;
  createdByUser: { id: ID; name: string };
  createdAt: string;
  updatedAt: string;
  /** Token de concurrencia: empieza en 1 y suma 1 en cada edición. Se reenvía como `expectedRevision` al editar. */
  revision: number;
}

/**
 * Edición parcial de un costo: solo se envía lo que cambia, más `expectedRevision` (obligatorio; RNF-20). `taskId: null` quita
 * la tarea; omitirlo la conserva.
 */
export interface UpdateCostDto {
  expectedRevision: number;
  costDate?: string;
  amount?: string;
  currency?: string;
  costCategoryId?: ID;
  description?: string;
  taskId?: ID | null;
  /** RN-21: solo hace falta si la edición mueve la fecha a una anterior al inicio del proyecto. */
  confirmBeforeProjectStart?: boolean;
}

// --- Presupuesto (POST/GET /projects/:projectId/budget) ---------------------------------------
// Datos económicos: solo los reciben ADMIN, PROGRAM_MANAGER y (GET) el líder real del proyecto.

/** Rubro del catálogo global de costos (GET /cost-categories devuelve solo los activos). */
export interface CostCategory {
  id: ID;
  name: string;
}

/** Una partida a cargar: importe como STRING, en la moneda del presupuesto (la partida no tiene moneda propia). */
export interface CreateBudgetItemDto {
  costCategoryId: ID;
  /** Igual que `totalAmount`: texto, >= 0, hasta 12 enteros y 2 decimales. */
  amount: string;
}

/** Partida de un presupuesto, con el nombre del rubro (también si el rubro quedó inactivo). */
export interface BudgetItem {
  costCategoryId: ID;
  categoryName: string;
  amount: string;
}

/** Snapshot económico completo del presupuesto. `version`, `isCurrent` y `createdBy` los fija el servidor. */
export interface CreateBudgetDto {
  /** Importe como STRING (nunca number: sin floating point), hasta 12 enteros y 2 decimales, >= 0. */
  totalAmount: string;
  /**
   * OPCIONAL y desaconsejada: el presupuesto SIEMPRE usa la moneda del proyecto (`Project.economicCurrency`), que el backend
   * deriva. Si se envía y es distinta responde 400 PROJECT_CURRENCY_MISMATCH; una versión nueva tampoco puede cambiarla.
   */
  currency?: string;
  /** YYYY-MM-DD */
  approvalDate: string;
  /** Desglose por rubro: obligatorio, 1 a 100 partidas, sin rubros repetidos; la suma debe ser igual a `totalAmount`. */
  items: CreateBudgetItemDto[];
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
  /** Desglose por rubro de ESTA versión, ordenado por nombre de rubro. */
  items: BudgetItem[];
}

/**
 * Una versión del historial: el mismo `Budget` (con SUS propias partidas) más quién la creó. `createdByUser` lo resuelve el
 * servidor aunque el usuario esté dado de baja; solo id y nombre (lo que necesita "Versión 3 — creada por Alicia — 25/10/2026").
 */
export interface BudgetHistoryEntry extends Budget {
  createdByUser: { id: ID; name: string };
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
  assignedToId?: ID | null;
  createdBy?: ID;
  subtaskCount?: number;
  completedSubtaskCount?: number;
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
