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