/**
 * Enums de dominio, espejados como Postgres ENUM nativos en la migration
 * (ver src/database/migrations/*-InitialSchema.ts).
 */

export enum RoleName {
  ADMIN = 'ADMIN',
  PROGRAM_MANAGER = 'PROGRAM_MANAGER',
  PROJECT_LEADER = 'PROJECT_LEADER',
  COLLABORATOR = 'COLLABORATOR',
  OBSERVER = 'OBSERVER',
}

export enum ProjectStatus {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  PAUSED = 'PAUSED',
  FINISHED = 'FINISHED',
  CANCELLED = 'CANCELLED',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  BLOCKED = 'BLOCKED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum DependencyType {
  FINISH_START = 'FINISH_START',
  START_START = 'START_START',
  FINISH_FINISH = 'FINISH_FINISH',
  START_FINISH = 'START_FINISH',
}

export enum AuditEntityType {
  TASK = 'TASK',
  PROJECT = 'PROJECT',
  BUDGET = 'BUDGET',
  COST = 'COST',
}

export enum AuditOrigin {
  UI = 'UI',
  AI = 'AI',
  SYSTEM = 'SYSTEM',
}

export enum NotificationChannel {
  IN_APP = 'IN_APP',
  EMAIL = 'EMAIL',
}

export enum AiMessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
  TOOL = 'TOOL',
  SYSTEM = 'SYSTEM',
}

/** Proveedores de identidad externa soportados por external_accounts. Hoy solo Google. */
export enum ExternalAccountProvider {
  GOOGLE = 'GOOGLE',
}

export enum ProjectActivityAction {
  PROJECT_CREATED = 'PROJECT_CREATED',
  PROJECT_UPDATED = 'PROJECT_UPDATED',
  PROJECT_ARCHIVED = 'PROJECT_ARCHIVED',
  PROJECT_DELETED = 'PROJECT_DELETED',
  MEMBER_ADDED = 'MEMBER_ADDED',
  MEMBER_ROLE_CHANGED = 'MEMBER_ROLE_CHANGED',
  MEMBER_REMOVED = 'MEMBER_REMOVED',
  TASK_CREATED = 'TASK_CREATED',
  TASK_UPDATED = 'TASK_UPDATED',
  TASK_DELETED = 'TASK_DELETED',
}

export enum ProjectActivityEntityType {
  PROJECT = 'PROJECT',
  MEMBER = 'MEMBER',
  TASK = 'TASK',
}
