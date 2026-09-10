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

export interface Project {
  id: ID;
  name: string;
  description: string | null;
  startDate: string | null;
  estimatedEndDate: string | null;
  status: ProjectStatus;
  leaderId: ID;
  createdBy: ID;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CreateProjectDto {
  name: string;
  description?: string;
  leaderId: ID;
  createdBy?: ID;
  startDate?: string;
  estimatedEndDate?: string;
}

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
}
