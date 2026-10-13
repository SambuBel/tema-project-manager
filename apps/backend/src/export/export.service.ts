import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectSlugHistoryEntity } from '../projects/project-slug-history.entity';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ProjectMemberRole, RoleName } from '../database/enums';

const TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En progreso',
  IN_REVIEW: 'En revisión',
  BLOCKED: 'Bloqueada',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

const TASK_PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

const PROJECT_STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Planificado',
  IN_PROGRESS: 'En curso',
  PAUSED: 'En pausa',
  FINISHED: 'Finalizado',
  CANCELLED: 'Cancelado',
};

export interface ExportTaskFilters {
  status?: string;
  priority?: string;
  assignedToId?: string;
  search?: string;
}

@Injectable()
export class ExportService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ProjectStatusHistoryEntity)
    private readonly statusHistoryRepo: Repository<ProjectStatusHistoryEntity>,
    private readonly permissions: PermissionsService,
  ) {}

  /* Helpers internos */

  private async findProjectOrThrow(projectIdOrSlug: string): Promise<ProjectEntity> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectIdOrSlug);
    const where = isUuid ? { id: projectIdOrSlug } : { slug: projectIdOrSlug };
    let project = await this.projectRepo.findOne({ where: where as any });

    if (!project && !isUuid) {
      const history = await this.projectRepo.manager.findOne(ProjectSlugHistoryEntity, {
        where: { slug: projectIdOrSlug },
      })
      if (history?.projectId) {
        project = await this.projectRepo.findOne({ where: { id: history.projectId } })
      }
    }

    if (!project) throw new NotFoundException(`Proyecto ${projectIdOrSlug} no encontrado.`);
    return project;
  }

  private async checkExportPermission(
    user: RequestUser,
    project: ProjectEntity,
  ): Promise<'full' | 'own-tasks'> {
    if (
      this.permissions.hasAnyGlobalRole(user, [RoleName.ADMIN, RoleName.PROGRAM_MANAGER]) ||
      this.permissions.isProjectLeader(user, project)
    ) {
      return 'full';
    }

    const membership = await this.permissions.getProjectMembership(user.id, project.id);
    if (!membership) {
      throw new ForbiddenException('No tenés acceso a exportar información de este proyecto.');
    }

    if (membership.projectRole === ProjectMemberRole.COLLABORATOR) {
      return 'own-tasks';
    }

    // Observer u otro rol
    throw new ForbiddenException('Tu rol en este proyecto no permite exportar información.');
  }

  /* Exportar tareas a CSV */

  async exportTasksCsv(
    projectIdOrSlug: string,
    filters: ExportTaskFilters,
    user: RequestUser,
  ): Promise<string> {
    const project = await this.findProjectOrThrow(projectIdOrSlug);
    const access = await this.checkExportPermission(user, project);

    const qb = this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignedTo', 'assignedTo')
      .where('task.projectId = :projectId', { projectId: project.id })
      .andWhere('task.archivedAt IS NULL');

    // Filtros de pantalla
    if (filters.status) {
      qb.andWhere('task.status = :status', { status: filters.status });
    }
    if (filters.priority) {
      qb.andWhere('task.priority = :priority', { priority: filters.priority });
    }
    if (filters.assignedToId) {
      qb.andWhere('task.assignedToId = :assignedToId', { assignedToId: filters.assignedToId });
    }
    if (filters.search) {
      qb.andWhere(
        '(task.title ILIKE :search OR task.description ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    // Collaborator solo exporta sus tareas
    if (access === 'own-tasks') {
      qb.andWhere(
        '(task.assignedToId = :userId OR task.createdBy = :userId)',
        { userId: user.id },
      );
    }

    const tasks = await qb.orderBy('task.createdAt', 'DESC').getMany();

    const headers = ['Título', 'Descripción', 'Estado', 'Prioridad', 'Responsable', 'Fecha inicio', 'Fecha vencimiento', 'Creada'];
    const rows = tasks.map((t) => [
      t.title,
      t.description ?? '',
      TASK_STATUS_LABELS[t.status] ?? t.status,
      TASK_PRIORITY_LABELS[t.priority] ?? t.priority,
      t.assignedTo?.name ?? 'Sin asignar',
      t.startDate ?? '',
      t.dueDate ?? '',
      this.formatDate(t.createdAt),
    ]);

    return this.buildCsv(project.name, user.name || user.email, headers, rows);
  }

  /* Exportar historial de estados a CSV */

  async exportStatusHistoryCsv(
    projectIdOrSlug: string,
    user: RequestUser,
  ): Promise<string> {
    const project = await this.findProjectOrThrow(projectIdOrSlug);
    const access = await this.checkExportPermission(user, project);

    // El historial de estados es info del proyecto, no de tareas individuales.
    if (access === 'own-tasks') {
      throw new ForbiddenException('Tu rol solo permite exportar tus propias tareas, no el historial de estados.');
    }

    const entries = await this.statusHistoryRepo
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.changedByUser', 'changedByUser')
      .where('h.projectId = :projectId', { projectId: project.id })
      .orderBy('h.changedAt', 'ASC')
      .getMany();

    const headers = ['Fecha', 'Estado anterior', 'Estado nuevo', 'Cambiado por'];
    const rows = entries.map((e) => [
      this.formatDate(e.changedAt),
      e.previousStatus ? (PROJECT_STATUS_LABELS[e.previousStatus] ?? e.previousStatus) : '(inicial)',
      PROJECT_STATUS_LABELS[e.newStatus] ?? e.newStatus,
      e.changedByUser?.name ?? 'Usuario desconocido',
    ]);

    return this.buildCsv(project.name, user.name || user.email, headers, rows);
  }

  /*  Generación de CSV */

  /** encabezado con proyecto, fecha/hora y usuario que genera. */
  private buildCsv(
    projectName: string,
    userName: string,
    headers: string[],
    rows: string[][],
  ): string {
    const now = new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // BOM UTF-8 para que Excel interprete bien los acentos
    const BOM = '\uFEFF';

    const meta = [
      this.escapeCsv(`Proyecto: ${projectName}`),
      this.escapeCsv(`Generado: ${now}`),
      this.escapeCsv(`Usuario: ${userName}`),
      '',
    ];

    const dataLines = [
      headers.map((h) => this.escapeCsv(h)).join(','),
      ...rows.map((row) => row.map((cell) => this.escapeCsv(cell)).join(',')),
    ];

    return BOM + [...meta, ...dataLines].join('\r\n');
  }

  private escapeCsv(val: string): string {
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }

  private formatDate(date: Date): string {
    return date.toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}