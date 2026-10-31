import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectSlugHistoryEntity } from '../projects/project-slug-history.entity';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { BudgetEntity } from '../database/entities/budget.entity';
import { BudgetItemEntity } from '../database/entities/budget-item.entity';
import { CostEntity } from '../database/entities/cost.entity';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ProjectMemberRole, RoleName } from '../database/enums';
import { ProjectsService } from '../projects/projects.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake');
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import * as path from 'path';
import { GanttService } from '../gantt/gantt.service';
import type { GanttTaskDto, GanttDependencyDto } from '../gantt/dto/gantt-response.dto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp');

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

const STATUS_BAR_COLORS: Record<string, string> = {
  PENDING: '#94A3B8',
  IN_PROGRESS: '#245B78',
  IN_REVIEW: '#7C3AED',
  BLOCKED: '#DC2626',
  COMPLETED: '#16A34A',
};

const fontsDir = path.join(process.cwd(), 'assets', 'fonts');

const pdfPrinter = new PdfPrinter({
  Roboto: {
    normal: path.join(fontsDir, 'Roboto-Regular.ttf'),
    bold: path.join(fontsDir, 'Roboto-Medium.ttf'),
    italics: path.join(fontsDir, 'Roboto-Italic.ttf'),
    bolditalics: path.join(fontsDir, 'Roboto-MediumItalic.ttf'),
  },
});

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
    @InjectRepository(BudgetEntity)
    private readonly budgetRepo: Repository<BudgetEntity>,
    @InjectRepository(BudgetItemEntity)
    private readonly budgetItemRepo: Repository<BudgetItemEntity>,
    @InjectRepository(CostEntity)
    private readonly costRepo: Repository<CostEntity>,
    private readonly permissions: PermissionsService,
    private readonly projectsService: ProjectsService,
    private readonly ganttService: GanttService,
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

  /* Exportar reporte económico a CSV */

async exportEconomicReportCsv(
  projectIdOrSlug: string,
  user: RequestUser,
): Promise<string> {
  const project = await this.findProjectOrThrow(projectIdOrSlug);
  const access = await this.checkExportPermission(user, project);

  // Info económica solo para roles con acceso completo
  if (access === 'own-tasks') {
    throw new ForbiddenException('Tu rol no permite acceder a la información económica del proyecto.');
  }

  // Presupuesto vigente con sus partidas
  const budget = await this.budgetRepo.findOne({
    where: { projectId: project.id, isCurrent: true },
  });

  let budgetItems: BudgetItemEntity[] = [];
  if (budget) {
    budgetItems = await this.budgetItemRepo.find({
      where: { budgetId: budget.id },
      relations: ['costCategory'],
      order: { costCategory: { name: 'ASC' } },
    });
  }

  // Costos del proyecto (no eliminados)
  const costs = await this.costRepo
    .createQueryBuilder('cost')
    .leftJoinAndSelect('cost.costCategory', 'category')
    .leftJoinAndSelect('cost.task', 'task')
    .leftJoinAndSelect('cost.creator', 'creator')
    .where('cost.projectId = :projectId', { projectId: project.id })
    .andWhere('cost.deletedAt IS NULL')
    .orderBy('cost.costDate', 'DESC')
    .getMany();

  // --- Sección 1: Resumen por rubro ---
  const summaryHeaders = ['Rubro', 'Presupuestado', 'Incurrido', 'Disponible'];

  // Agrupar costos incurridos por categoría
  const incurredByCategory: Record<string, number> = {};
  for (const cost of costs) {
    const catId = cost.costCategoryId;
    incurredByCategory[catId] = (incurredByCategory[catId] || 0) + parseFloat(cost.amount);
  }

  const summaryRows: string[][] = [];
  let totalBudgeted = 0;
  let totalIncurred = 0;

  for (const item of budgetItems) {
    const budgeted = parseFloat(item.amount);
    const incurred = incurredByCategory[item.costCategoryId] || 0;
    const available = budgeted - incurred;
    totalBudgeted += budgeted;
    totalIncurred += incurred;

    summaryRows.push([
      item.costCategory?.name ?? 'Sin rubro',
      budgeted.toFixed(2),
      incurred.toFixed(2),
      available.toFixed(2),
    ]);

    // Marcar como ya incluido
    delete incurredByCategory[item.costCategoryId];
  }

  // Costos en rubros que no están en el presupuesto
  for (const [catId, incurred] of Object.entries(incurredByCategory)) {
    const catCost = costs.find(c => c.costCategoryId === catId);
    summaryRows.push([
      catCost?.costCategory?.name ?? 'Sin rubro',
      '0.00',
      incurred.toFixed(2),
      (-incurred).toFixed(2),
    ]);
    totalIncurred += incurred;
  }

  // Fila de totales
  summaryRows.push([
    'TOTAL',
    totalBudgeted.toFixed(2),
    totalIncurred.toFixed(2),
    (totalBudgeted - totalIncurred).toFixed(2),
  ]);

  // --- Sección 2: Detalle de costos ---
  const detailHeaders = ['Fecha', 'Rubro', 'Monto', 'Moneda', 'Descripción', 'Tarea', 'Registrado por'];
  const detailRows = costs.map(c => [
    c.costDate,
    c.costCategory?.name ?? 'Sin rubro',
    c.amount,
    c.currency,
    c.description,
    c.task?.title ?? '—',
    c.creator?.name ?? 'Usuario desconocido',
  ]);

  // Armar CSV completo
  const currency = budget?.currency ?? project.economicCurrency ?? '';
    return this.buildEconomicCsv(project.name, user.name || user.email, currency, summaryHeaders, summaryRows, detailHeaders, detailRows);
  }

    /* Exportar vista de portafolio a CSV */

  async exportPortfolioCsv(user: RequestUser): Promise<string> {
    // Reutilizamos findAll que ya filtra por permisos del usuario
    const projects = await this.projectsService.findAll({}, user);

    const headers = [
      'Nombre',
      'Estado',
      'Líder',
      'Avance (%)',
      'Miembros',
      'Fecha inicio',
      'Fecha estimada fin',
      'Creado',
    ];

    const rows = projects.map((p) => [
      p.name,
      PROJECT_STATUS_LABELS[p.status] ?? p.status,
      p.leader?.name ?? 'Sin asignar',
      String(p.progress ?? 0),
      String(p.memberCount ?? 0),
      p.startDate ?? '',
      p.estimatedEndDate ?? '',
      this.formatDate(new Date(p.createdAt)),
    ]);

    return this.buildCsv('Portafolio de proyectos', user.name || user.email, headers, rows);
  }

    /* ========== Exportaciones a PDF ========== */

  async exportTasksPdf(
    projectIdOrSlug: string,
    filters: ExportTaskFilters,
    user: RequestUser,
  ): Promise<Buffer> {
    const project = await this.findProjectOrThrow(projectIdOrSlug);
    const access = await this.checkExportPermission(user, project);

    const qb = this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignedTo', 'assignedTo')
      .where('task.projectId = :projectId', { projectId: project.id })
      .andWhere('task.archivedAt IS NULL');

    if (filters.status) qb.andWhere('task.status = :status', { status: filters.status });
    if (filters.priority) qb.andWhere('task.priority = :priority', { priority: filters.priority });
    if (filters.assignedToId) qb.andWhere('task.assignedToId = :assignedToId', { assignedToId: filters.assignedToId });
    if (filters.search) qb.andWhere('(task.title ILIKE :search OR task.description ILIKE :search)', { search: `%${filters.search}%` });
    if (access === 'own-tasks') qb.andWhere('(task.assignedToId = :userId OR task.createdBy = :userId)', { userId: user.id });

    const tasks = await qb.orderBy('task.createdAt', 'DESC').getMany();

    const tableBody: any[][] = [
      ['Título', 'Estado', 'Prioridad', 'Responsable', 'Fecha inicio', 'Vencimiento'].map(h => ({ text: h, bold: true, fillColor: '#245B78', color: '#FFFFFF', fontSize: 9 })),
      ...tasks.map(t => [
        { text: t.title, fontSize: 8 },
        { text: TASK_STATUS_LABELS[t.status] ?? t.status, fontSize: 8 },
        { text: TASK_PRIORITY_LABELS[t.priority] ?? t.priority, fontSize: 8 },
        { text: t.assignedTo?.name ?? 'Sin asignar', fontSize: 8 },
        { text: t.startDate ?? '—', fontSize: 8 },
        { text: t.dueDate ?? '—', fontSize: 8 },
      ]),
    ];

    return this.buildPdf(project.name, 'Listado de tareas', user.name || user.email, [
      {
        table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'], body: tableBody },
        layout: 'lightHorizontalLines',
      },
      { text: `Total: ${tasks.length} tarea(s)`, fontSize: 9, margin: [0, 8, 0, 0], italics: true },
    ]);
  }

  async exportEconomicReportPdf(
    projectIdOrSlug: string,
    user: RequestUser,
  ): Promise<Buffer> {
    const project = await this.findProjectOrThrow(projectIdOrSlug);
    const access = await this.checkExportPermission(user, project);
    if (access === 'own-tasks') {
      throw new ForbiddenException('Tu rol no permite acceder a la información económica del proyecto.');
    }

    const budget = await this.budgetRepo.findOne({ where: { projectId: project.id, isCurrent: true } });
    let budgetItems: BudgetItemEntity[] = [];
    if (budget) {
      budgetItems = await this.budgetItemRepo.find({ where: { budgetId: budget.id }, relations: ['costCategory'], order: { costCategory: { name: 'ASC' } } });
    }

    const costs = await this.costRepo
      .createQueryBuilder('cost')
      .leftJoinAndSelect('cost.costCategory', 'category')
      .leftJoinAndSelect('cost.task', 'task')
      .leftJoinAndSelect('cost.creator', 'creator')
      .where('cost.projectId = :projectId', { projectId: project.id })
      .andWhere('cost.deletedAt IS NULL')
      .orderBy('cost.costDate', 'DESC')
      .getMany();

    const incurredByCategory: Record<string, number> = {};
    for (const cost of costs) {
      incurredByCategory[cost.costCategoryId] = (incurredByCategory[cost.costCategoryId] || 0) + parseFloat(cost.amount);
    }

    const summaryBody: any[][] = [
      ['Rubro', 'Presupuestado', 'Incurrido', 'Disponible'].map(h => ({ text: h, bold: true, fillColor: '#245B78', color: '#FFFFFF', fontSize: 9 })),
    ];
    let totalBudgeted = 0;
    let totalIncurred = 0;

    for (const item of budgetItems) {
      const budgeted = parseFloat(item.amount);
      const incurred = incurredByCategory[item.costCategoryId] || 0;
      totalBudgeted += budgeted;
      totalIncurred += incurred;
      summaryBody.push([
        { text: item.costCategory?.name ?? 'Sin rubro', fontSize: 8 },
        { text: budgeted.toFixed(2), fontSize: 8, alignment: 'right' },
        { text: incurred.toFixed(2), fontSize: 8, alignment: 'right' },
        { text: (budgeted - incurred).toFixed(2), fontSize: 8, alignment: 'right' },
      ]);
      delete incurredByCategory[item.costCategoryId];
    }

    for (const [catId, incurred] of Object.entries(incurredByCategory)) {
      const catCost = costs.find(c => c.costCategoryId === catId);
      summaryBody.push([
        { text: catCost?.costCategory?.name ?? 'Sin rubro', fontSize: 8 },
        { text: '0.00', fontSize: 8, alignment: 'right' },
        { text: incurred.toFixed(2), fontSize: 8, alignment: 'right' },
        { text: (-incurred).toFixed(2), fontSize: 8, alignment: 'right' },
      ]);
      totalIncurred += incurred;
    }

    summaryBody.push([
      { text: 'TOTAL', bold: true, fontSize: 9 },
      { text: totalBudgeted.toFixed(2), bold: true, fontSize: 9, alignment: 'right' },
      { text: totalIncurred.toFixed(2), bold: true, fontSize: 9, alignment: 'right' },
      { text: (totalBudgeted - totalIncurred).toFixed(2), bold: true, fontSize: 9, alignment: 'right' },
    ]);

    const currency = budget?.currency ?? project.economicCurrency ?? '';

    const content: Content[] = [
      { text: `Moneda: ${currency}`, fontSize: 10, margin: [0, 0, 0, 10] },
      { text: 'Resumen por rubro', style: 'sectionHeader' },
      { table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: summaryBody }, layout: 'lightHorizontalLines' },
    ];

    if (costs.length > 0) {
      const detailBody: any[][] = [
        ['Fecha', 'Rubro', 'Monto', 'Descripción', 'Tarea', 'Registrado por'].map(h => ({ text: h, bold: true, fillColor: '#245B78', color: '#FFFFFF', fontSize: 9 })),
        ...costs.map(c => [
          { text: c.costDate, fontSize: 8 },
          { text: c.costCategory?.name ?? 'Sin rubro', fontSize: 8 },
          { text: `${c.currency} ${c.amount}`, fontSize: 8, alignment: 'right' },
          { text: c.description, fontSize: 8 },
          { text: c.task?.title ?? '—', fontSize: 8 },
          { text: c.creator?.name ?? 'Usuario desconocido', fontSize: 8 },
        ]),
      ];

      content.push(
        { text: '', margin: [0, 15, 0, 0] },
        { text: 'Detalle de costos', style: 'sectionHeader' },
        { table: { headerRows: 1, widths: ['auto', 'auto', 'auto', '*', 'auto', 'auto'], body: detailBody }, layout: 'lightHorizontalLines' },
      );
    }

    return this.buildPdf(project.name, 'Reporte económico', user.name || user.email, content);
  }

  async exportPortfolioPdf(user: RequestUser): Promise<Buffer> {
    const projects = await this.projectsService.findAll({}, user);

    const tableBody: any[][] = [
      ['Nombre', 'Estado', 'Líder', 'Avance', 'Miembros', 'Fecha inicio', 'Entrega est.'].map(h => ({ text: h, bold: true, fillColor: '#245B78', color: '#FFFFFF', fontSize: 9 })),
      ...projects.map(p => [
        { text: p.name, fontSize: 8 },
        { text: PROJECT_STATUS_LABELS[p.status] ?? p.status, fontSize: 8 },
        { text: p.leader?.name ?? 'Sin asignar', fontSize: 8 },
        { text: `${p.progress ?? 0}%`, fontSize: 8, alignment: 'right' },
        { text: String(p.memberCount ?? 0), fontSize: 8, alignment: 'center' },
        { text: p.startDate ?? '—', fontSize: 8 },
        { text: p.estimatedEndDate ?? '—', fontSize: 8 },
      ]),
    ];

    return this.buildPdf('Portafolio de proyectos', 'Vista general', user.name || user.email, [
      {
        table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'], body: tableBody },
        layout: 'lightHorizontalLines',
      },
      { text: `Total: ${projects.length} proyecto(s)`, fontSize: 9, margin: [0, 8, 0, 0], italics: true },
    ]);
  }

    /* ========== Exportaciones del Gantt ========== */

  async exportGanttPng(projectIdOrSlug: string, user: RequestUser): Promise<Buffer> {
    const ganttData = await this.ganttService.getGantt(projectIdOrSlug, user);
    const svg = this.buildGanttSvg(
      ganttData.project.name,
      ganttData.tasks,
      ganttData.dependencies,
    );
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  async exportGanttPdf(projectIdOrSlug: string, user: RequestUser): Promise<Buffer> {
    const ganttData = await this.ganttService.getGantt(projectIdOrSlug, user);
    const svg = this.buildGanttSvg(
      ganttData.project.name,
      ganttData.tasks,
      ganttData.dependencies,
    );
    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const base64 = pngBuffer.toString('base64');

    return this.buildPdf(ganttData.project.name, 'Diagrama de Gantt', user.name || user.email, [
      {
        image: `data:image/png;base64,${base64}`,
        width: 770,
      },
    ]);
  }

  /* ---------- SVG builder del Gantt ---------- */

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private truncateText(str: string, max: number): string {
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  private orderTasksForGantt(tasks: GanttTaskDto[]): GanttTaskDto[] {
    const roots = tasks.filter((t) => !t.parentTaskId);
    const childrenMap = new Map<string, GanttTaskDto[]>();
    for (const t of tasks) {
      if (t.parentTaskId) {
        const siblings = childrenMap.get(t.parentTaskId) ?? [];
        siblings.push(t);
        childrenMap.set(t.parentTaskId, siblings);
      }
    }
    const result: GanttTaskDto[] = [];
    for (const root of roots) {
      result.push(root);
      const children = childrenMap.get(root.id) ?? [];
      result.push(...children);
    }
    return result;
  }

  private buildGanttSvg(
    projectName: string,
    tasks: GanttTaskDto[],
    dependencies: GanttDependencyDto[],
  ): string {
    const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const MS_PER_DAY = 86_400_000;

    // Solo tareas que tienen ambas fechas
    const datedTasks = tasks.filter((t) => t.startDate && t.dueDate);
    const undatedCount = tasks.length - datedTasks.length;

    if (datedTasks.length === 0) {
      return [
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="80">',
        '<rect width="600" height="80" fill="#FFFFFF"/>',
        '<text x="300" y="45" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" fill="#607185">',
        'No hay tareas con fechas para mostrar en el diagrama.',
        '</text>',
        '</svg>',
      ].join('\n');
    }

    const ordered = this.orderTasksForGantt(datedTasks);

    // Rango de fechas con margen
    const allStarts = datedTasks.map((t) => new Date(t.startDate!).getTime());
    const allEnds = datedTasks.map((t) => new Date(t.dueDate!).getTime());
    const rangeStart = new Date(Math.min(...allStarts));
    const rangeEnd = new Date(Math.max(...allEnds));
    rangeStart.setDate(rangeStart.getDate() - 3);
    rangeEnd.setDate(rangeEnd.getDate() + 3);
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd.setHours(0, 0, 0, 0);

    const totalDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / MS_PER_DAY);

    // Dimensiones
    const LEFT_W = 200;
    const ROW_H = 28;
    const HEADER_H = 40;
    const BAR_H = 16;
    const BAR_MARGIN = (ROW_H - BAR_H) / 2;
    const PX_PER_DAY = Math.min(28, Math.max(6, Math.floor(950 / totalDays)));
    const TIMELINE_W = totalDays * PX_PER_DAY;
    const W = LEFT_W + TIMELINE_W;
    const CONTENT_H = ordered.length * ROW_H;
    const NOTE_H = undatedCount > 0 ? 24 : 0;
    const H = HEADER_H + CONTENT_H + NOTE_H;

    const dayX = (date: Date): number => {
      const diff = (date.getTime() - rangeStart.getTime()) / MS_PER_DAY;
      return LEFT_W + diff * PX_PER_DAY;
    };

    const svg: string[] = [];
    svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);

    // Marcador de flecha para dependencias
    svg.push('<defs>');
    svg.push('<marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">');
    svg.push('<path d="M0,0 L6,3 L0,6 Z" fill="#607185"/>');
    svg.push('</marker>');
    svg.push('</defs>');

    // Fondo blanco
    svg.push(`<rect width="${W}" height="${H}" fill="#FFFFFF"/>`);
    // Panel izquierdo
    svg.push(`<rect x="0" y="0" width="${LEFT_W}" height="${H}" fill="#F8FAFC"/>`);
    // Encabezado oscuro
    svg.push(`<rect x="0" y="0" width="${W}" height="${HEADER_H}" fill="#172B42"/>`);
    // Nombre del proyecto
    svg.push(`<text x="10" y="26" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#FFFFFF">${this.escapeXml(this.truncateText(projectName, 28))}</text>`);

    // Etiquetas de meses
    const cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const visStart = new Date(Math.max(monthStart.getTime(), rangeStart.getTime()));
      const visEnd = new Date(Math.min(monthEnd.getTime(), rangeEnd.getTime()));
      const x1 = dayX(visStart);
      const x2 = dayX(visEnd) + PX_PER_DAY;
      const midX = (x1 + x2) / 2;
      const label = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
      svg.push(`<text x="${midX}" y="16" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="#FFFFFF" opacity="0.9">${label}</text>`);
      if (x1 > LEFT_W) {
        svg.push(`<line x1="${x1}" y1="0" x2="${x1}" y2="${H}" stroke="#DEE5EC" stroke-width="0.5"/>`);
      }
      cursor.setMonth(cursor.getMonth() + 1);
      cursor.setDate(1);
    }

    // Números de día (solo si caben)
    if (PX_PER_DAY >= 14) {
      const d = new Date(rangeStart);
      while (d <= rangeEnd) {
        const x = dayX(d) + PX_PER_DAY / 2;
        svg.push(`<text x="${x}" y="34" text-anchor="middle" font-family="Arial, sans-serif" font-size="7" fill="#FFFFFF" opacity="0.6">${d.getDate()}</text>`);
        d.setDate(d.getDate() + 1);
      }
    }

    // Separador panel izquierdo
    svg.push(`<line x1="${LEFT_W}" y1="0" x2="${LEFT_W}" y2="${H}" stroke="#DEE5EC" stroke-width="1"/>`);

    // Línea de "hoy"
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today >= rangeStart && today <= rangeEnd) {
      const tx = dayX(today);
      svg.push(`<line x1="${tx}" y1="${HEADER_H}" x2="${tx}" y2="${HEADER_H + CONTENT_H}" stroke="#DC2626" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7"/>`);
    }

    // Índice de tareas (para dibujar dependencias después)
    const taskIndexMap = new Map<string, number>();
    ordered.forEach((t, i) => taskIndexMap.set(t.id, i));

    // Filas de tareas
    for (let i = 0; i < ordered.length; i++) {
      const task = ordered[i];
      if (!task) continue;
      const y = HEADER_H + i * ROW_H;

      // Fondo alternado
      if (i % 2 === 0) {
        svg.push(`<rect x="${LEFT_W}" y="${y}" width="${TIMELINE_W}" height="${ROW_H}" fill="#F8FAFC"/>`);
      }
      // Línea horizontal
      svg.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#EAF2F7" stroke-width="0.5"/>`);

      // Nombre de la tarea
      const isSubtask = !!task.parentTaskId;
      const textX = isSubtask ? 24 : 10;
      const prefix = isSubtask ? '› ' : '';
      const maxChars = isSubtask ? 22 : 25;
      const name = prefix + this.truncateText(task.title, maxChars);
      const textY = y + ROW_H / 2 + 4;
      const fontSize = isSubtask ? '8' : '9';
      const fontWeight = isSubtask ? 'normal' : '600';
      svg.push(`<text x="${textX}" y="${textY}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="#172B42">${this.escapeXml(name)}</text>`);

      // Barra de la tarea
      if (task.startDate && task.dueDate) {
        const barStart = dayX(new Date(task.startDate));
        const barEnd = dayX(new Date(task.dueDate)) + PX_PER_DAY;
        const barW = Math.max(barEnd - barStart, 4);
        const barY = y + BAR_MARGIN;
        const color = STATUS_BAR_COLORS[task.status] ?? '#94A3B8';
        svg.push(`<rect x="${barStart}" y="${barY}" width="${barW}" height="${BAR_H}" rx="3" ry="3" fill="${color}"/>`);

        // Título dentro de la barra si entra
        if (barW > 60) {
          const barLabel = this.truncateText(task.title, Math.floor(barW / 5));
          svg.push(`<text x="${barStart + 5}" y="${barY + BAR_H / 2 + 3}" font-family="Arial, sans-serif" font-size="7" fill="#FFFFFF">${this.escapeXml(barLabel)}</text>`);
        }
      }
    }

    // Línea inferior
    svg.push(`<line x1="0" y1="${HEADER_H + CONTENT_H}" x2="${W}" y2="${HEADER_H + CONTENT_H}" stroke="#DEE5EC" stroke-width="1"/>`);

    // Flechas de dependencias
    for (const dep of dependencies) {
      const predIdx = taskIndexMap.get(dep.predecessorTaskId);
      const succIdx = taskIndexMap.get(dep.successorTaskId);
      if (predIdx === undefined || succIdx === undefined) continue;
      const pred = ordered[predIdx];
      const succ = ordered[succIdx];
      if (!pred?.dueDate || !succ?.startDate) continue;

      const x1 = dayX(new Date(pred.dueDate)) + PX_PER_DAY;
      const y1 = HEADER_H + predIdx * ROW_H + ROW_H / 2;
      const x2 = dayX(new Date(succ.startDate));
      const y2 = HEADER_H + succIdx * ROW_H + ROW_H / 2;
      const midX = x1 + 6;
      svg.push(`<path d="M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}" fill="none" stroke="#607185" stroke-width="1" marker-end="url(#arr)"/>`);
    }

    // Nota de tareas sin fechas
    if (undatedCount > 0) {
      const noteY = HEADER_H + CONTENT_H + 16;
      svg.push(`<text x="10" y="${noteY}" font-family="Arial, sans-serif" font-size="8" fill="#607185" font-style="italic">${undatedCount} tarea(s) sin fechas asignadas no se muestran.</text>`);
    }

    svg.push('</svg>');
    return svg.join('\n');
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

  private buildEconomicCsv(
  projectName: string,
  userName: string,
  currency: string,
  summaryHeaders: string[],
  summaryRows: string[][],
  detailHeaders: string[],
  detailRows: string[][],
): string {
  const now = new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const BOM = '\uFEFF';

  const lines: string[] = [
    this.escapeCsv(`Proyecto: ${projectName}`),
    this.escapeCsv(`Reporte económico`),
    this.escapeCsv(`Moneda: ${currency}`),
    this.escapeCsv(`Generado: ${now}`),
    this.escapeCsv(`Usuario: ${userName}`),
    '',
    this.escapeCsv('RESUMEN POR RUBRO'),
    summaryHeaders.map(h => this.escapeCsv(h)).join(','),
    ...summaryRows.map(row => row.map(cell => this.escapeCsv(cell)).join(',')),
    '',
    this.escapeCsv('DETALLE DE COSTOS'),
    detailHeaders.map(h => this.escapeCsv(h)).join(','),
    ...detailRows.map(row => row.map(cell => this.escapeCsv(cell)).join(',')),
  ];

    return BOM + lines.join('\r\n');
  }

    private buildPdf(
    title: string,
    subtitle: string,
    userName: string,
    content: Content[],
  ): Promise<Buffer> {
    const now = new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const docDefinition: TDocumentDefinitions = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [30, 60, 30, 40],
      header: {
        columns: [
          { text: title, fontSize: 14, bold: true, color: '#172B42', margin: [30, 15, 0, 0] },
          { text: subtitle, fontSize: 10, color: '#607185', alignment: 'right', margin: [0, 18, 30, 0] },
        ],
      },
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: `Generado: ${now} — ${userName}`, fontSize: 7, color: '#607185', margin: [30, 0, 0, 0] },
          { text: `Página ${currentPage} de ${pageCount}`, fontSize: 7, color: '#607185', alignment: 'right', margin: [0, 0, 30, 0] },
        ],
      }),
      content,
      styles: {
        sectionHeader: { fontSize: 11, bold: true, color: '#172B42', margin: [0, 0, 0, 6] },
      },
      defaultStyle: { font: 'Roboto' },
    };

    const pdfDoc = pdfPrinter.createPdfKitDocument(docDefinition);
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });
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