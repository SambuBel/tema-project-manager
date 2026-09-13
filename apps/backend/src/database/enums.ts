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
