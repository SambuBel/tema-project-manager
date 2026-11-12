import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type { PaginatedResponse } from '@tema/shared-types';
import { CostEntity } from '../database/entities/cost.entity';
import { ProjectEntity } from '../projects/project.entity';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateCostDto } from './dto/create-cost.dto';
import { ListCostsQueryDto } from './dto/list-costs-query.dto';
import { UpdateCostDto } from './dto/update-cost.dto';
import { CostResponseDto, CostRow, toCostResponse } from './dto/cost-response.dto';
import { resolveProjectCurrency } from '../economy/project-currency';
import { ProjectAlertsService } from '../notifications/project-alerts.service';
import { noCurrentVersionError } from '../budgets/budget-integrity.errors';
import { CostCategoryCode } from '../budgets/budget-error-codes';
import { COST_SELECT, EDITABLE_COLUMNS, EDITABLE_FIELDS, EditableField } from './cost-queries';
import { CostState, CurrentBudget, CurrentCost, DateConfirmations, LockedCategory, LockedProject, OperationTexts } from './cost-types';
import { CREATE_TEXTS, NO_CONFIRMATIONS, resolveNextState, updateTexts } from './cost-rules';
import { COST_CREATED_ACTION, COST_UPDATED_ACTION, recordCostCreated, recordCostUpdated } from './cost-audit';

// Las specs y otros módulos importan estas constantes desde acá.
export { COST_CREATED_ACTION, COST_UPDATED_ACTION };

/** Mismos defaults que el listado de tareas. */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

const FORBIDDEN_VIEW_MESSAGE = 'No tenés permisos para ver la información económica de este proyecto.';

@Injectable()
export class CostsService {
  private readonly logger = new Logger(CostsService.name);

  constructor(
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    private readonly permissions: PermissionsService,
    private readonly dataSource: DataSource,
    private readonly projectAlerts: ProjectAlertsService,
  ) {}

  /** Registra un costo. 404 de proyecto ANTES que el 403 (los permisos dependen del proyecto, igual que GET /budget). */
  async create(projectId: string, dto: CreateCostDto, user: RequestUser): Promise<CostResponseDto> {
    const project = await this.findProjectOrThrow(projectId);
    if (!this.permissions.canManageCosts(user, project)) {
      throw new ForbiddenException('No tenés permisos para registrar costos en este proyecto.');
    }

    // Una sola transacción. El orden de los pasos es el orden de locks de la cabecera: proyecto FOR SHARE → rubro FOR SHARE →
    // lecturas (presupuesto, partida, tarea) → INSERT del costo → auditoría. Los errores salen en ESE orden (ej. los de presupuesto
    // antes que los de rubro), así que no reordenar.
    const response = await this.dataSource.transaction(async (manager) => {
      const lockedProject = await this.lockProject(manager, projectId, dto.currency);
      const lockedCategory = await this.lockCategory(manager, dto.costCategoryId);
      const budget = await this.getCurrentBudgetOrThrow(manager, projectId, CREATE_TEXTS);
      const category = await this.requireCategoryInBudget(manager, lockedCategory, dto.costCategoryId, budget, CREATE_TEXTS);
      const taskTitle = await this.findTaskTitleInProject(manager, projectId, dto.taskId);
      const confirmations = this.checkDateConfirmations(dto.costDate, dto, lockedProject, CREATE_TEXTS);

      const saved = await this.insertCost(manager, projectId, dto, user, category, lockedProject.currency);
      await recordCostCreated(manager, saved.id, projectId, dto, user, category, lockedProject.currency, budget, confirmations);

      const [row]: CostRow[] = await manager.query(`${COST_SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL`, [saved.id]);
      return toCostResponse({ ...row!, taskTitle });
    });
    await this.projectAlerts.checkBudgetAfterCostChange(projectId);
    return response;
  }

  /**
   * 1) Proyecto FOR SHARE (coordina con el FOR UPDATE del versionado de presupuesto y del cambio de moneda). Las fechas de inicio y
   * fin se leen BAJO el lock: nadie puede cambiarlas mientras se valida. La moneda ÚNICA del proyecto también: el costo siempre
   * está en ella; si el cliente mandó otra, 400 PROJECT_CURRENCY_MISMATCH. Nunca se convierte.
   */
  private async lockProject(manager: EntityManager, projectId: string, requestedCurrency: string | undefined): Promise<LockedProject> {
    const locked: Array<{ startDate: string | null; projectEndDate?: string | null; economicCurrency: string }> = await manager.query(
      'SELECT start_date::text AS "startDate", estimated_end_date::text AS "projectEndDate", economic_currency AS "economicCurrency" FROM projects WHERE id = $1 AND deleted_at IS NULL FOR SHARE',
      [projectId],
    );
    if (locked.length === 0) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    return {
      startDate: locked[0]!.startDate,
      // Fin ESTIMADO del proyecto (BUG-10). Sin fecha de fin no se aplica la validación de "posterior al fin".
      endDate: locked[0]!.projectEndDate ?? null,
      currency: resolveProjectCurrency(requestedCurrency, locked[0]!.economicCurrency, 'El costo'),
    };
  }

  /** 2) Rubro FOR SHARE (nadie lo desactiva entre la validación y el insert). Devuelve `undefined` si no existe: lo valida RN-20. */
  private async lockCategory(manager: EntityManager, costCategoryId: string): Promise<LockedCategory | undefined> {
    const categories: LockedCategory[] = await manager.query('SELECT id, name, active FROM cost_categories WHERE id = $1 FOR SHARE', [costCategoryId]);
    return categories[0];
  }

  /**
   * 3) Presupuesto vigente (solo is_current = true; nunca max(version)). Sin vigente: 500 BUDGET_NO_CURRENT_VERSION si hay versiones
   * (inconsistencia que no se intenta corregir) o 409 PROJECT_HAS_NO_CURRENT_BUDGET si nunca hubo presupuesto.
   */
  private async getCurrentBudgetOrThrow(manager: EntityManager, projectId: string, texts: OperationTexts): Promise<CurrentBudget> {
    const budgets: CurrentBudget[] = await manager.query('SELECT id, version FROM budgets WHERE project_id = $1 AND is_current = true', [projectId]);
    const budget = budgets[0];
    if (budget) return budget;

    const [counted]: Array<{ total: number }> = await manager.query('SELECT COUNT(*)::int AS total FROM budgets WHERE project_id = $1', [projectId]);
    const total = counted!.total;
    if (total > 0) {
      this.logger.error(`Inconsistencia: el proyecto ${projectId} tiene ${total} versión(es) de presupuesto pero NINGUNA vigente; ${texts.skippedAction}`);
      throw noCurrentVersionError();
    }
    throw new ConflictException({
      code: 'PROJECT_HAS_NO_CURRENT_BUDGET',
      message: texts.noBudget,
    });
  }

  /** RN-20: rubro existente, activo y con partida en el presupuesto vigente. Devuelve el rubro ya validado. */
  private async requireCategoryInBudget(
    manager: EntityManager,
    category: LockedCategory | undefined,
    requestedCategoryId: string,
    budget: CurrentBudget,
    texts: OperationTexts,
  ): Promise<LockedCategory> {
    if (!category) {
      throw new BadRequestException({ code: CostCategoryCode.NOT_FOUND, message: 'El rubro no existe.', costCategoryId: requestedCategoryId });
    }
    if (!category.active) {
      throw new BadRequestException({
        code: CostCategoryCode.INACTIVE,
        message: texts.inactiveCategory,
        costCategoryId: category.id,
      });
    }
    const items = await manager.query('SELECT 1 FROM budget_items WHERE budget_id = $1 AND cost_category_id = $2', [budget.id, category.id]);
    if (items.length === 0) {
      throw new BadRequestException({
        code: 'COST_CATEGORY_NOT_IN_CURRENT_BUDGET',
        message: 'El rubro no tiene una partida en el presupuesto vigente del proyecto.',
        costCategoryId: category.id,
      });
    }
    return category;
  }

  /**
   * Tarea opcional: debe existir y ser de ESTE proyecto. Un solo error: no revela que el UUID existe en otro proyecto. Devuelve su
   * título (para la respuesta) o `null` si no se indicó tarea.
   */
  private async findTaskTitleInProject(manager: EntityManager, projectId: string, taskId: string | undefined): Promise<string | null> {
    if (!taskId) return null;

    const tasks: Array<{ title: string }> = await manager.query('SELECT title FROM tasks WHERE id = $1 AND project_id = $2', [taskId, projectId]);
    if (tasks.length === 0) {
      throw new BadRequestException({
        code: 'TASK_NOT_AVAILABLE_FOR_PROJECT',
        message: 'La tarea no existe o no pertenece a este proyecto.',
      });
    }
    return tasks[0]!.title;
  }

  /**
   * Fecha del costo contra el período del proyecto (al registrar, o al editar cuando la fecha cambia). Las fechas YYYY-MM-DD se
   * comparan como texto (orden lexicográfico = cronológico); nunca como Date. Cada confirmación tiene su flag propio e independiente. Devuelve qué confirmaciones se usaron (van a la auditoría).
   *  - RN-21: anterior al inicio → 409 salvo `confirmBeforeProjectStart`. Sin fecha de inicio no se compara.
   *  - BUG-10: posterior al fin ESTIMADO → 409 salvo `confirmAfterProjectEnd`. Sin fecha de fin no se compara. No se bloquean las
   *    fechas futuras en sí: solo importa el fin del proyecto.
   */
  private checkDateConfirmations(
    costDate: string,
    confirm: { confirmBeforeProjectStart?: boolean; confirmAfterProjectEnd?: boolean },
    project: LockedProject,
    texts: OperationTexts,
  ): DateConfirmations {
    const beforeStart = project.startDate !== null && costDate < project.startDate;
    const confirmedBeforeProjectStart = beforeStart && confirm.confirmBeforeProjectStart === true;
    if (beforeStart && !confirmedBeforeProjectStart) {
      throw new ConflictException({
        code: 'COST_BEFORE_PROJECT_START_CONFIRMATION_REQUIRED',
        message: `La fecha del costo es anterior al inicio del proyecto. Confirmalo explícitamente para ${texts.confirmTo}.`,
        costDate,
        projectStartDate: project.startDate,
      });
    }

    const afterEnd = project.endDate !== null && costDate > project.endDate;
    const confirmedAfterProjectEnd = afterEnd && confirm.confirmAfterProjectEnd === true;
    if (afterEnd && !confirmedAfterProjectEnd) {
      throw new ConflictException({
        code: 'COST_AFTER_PROJECT_END_CONFIRMATION_REQUIRED',
        message: `La fecha del costo es posterior a la fecha estimada de finalización del proyecto. Confirmalo explícitamente para ${texts.confirmTo}.`,
        costDate,
        projectEndDate: project.endDate,
      });
    }

    return { confirmedBeforeProjectStart, confirmedAfterProjectEnd };
  }

  private insertCost(
    manager: EntityManager,
    projectId: string,
    dto: CreateCostDto,
    user: RequestUser,
    category: LockedCategory,
    currency: string,
  ): Promise<CostEntity> {
    return manager.save(
      manager.create(CostEntity, {
        projectId,
        taskId: dto.taskId ?? null,
        costCategoryId: category.id,
        amount: dto.amount,
        currency,
        costDate: dto.costDate,
        description: dto.description,
        createdBy: user.id,
      }),
    );
  }

  /** Total incurrido en una moneda, como texto con 2 decimales. Mismo orden que GET /costs: 404 de proyecto y después 403. */
  async getIncurredTotal(projectId: string, currency: string, user: RequestUser): Promise<string> {
    const project = await this.findProjectOrThrow(projectId);
    // RN-25: sin permiso económico → 403, nunca un total en cero.
    if (!this.permissions.canViewEconomicData(user, project)) {
      throw new ForbiddenException(FORBIDDEN_VIEW_MESSAGE);
    }

    const [row]: Array<{ total: string }> = await this.dataSource.manager.query(
      'SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text AS total FROM costs WHERE project_id = $1 AND currency = $2 AND deleted_at IS NULL',
      [projectId, currency],
    );
    return row!.total;
  }

  /**
   * Costos NO eliminados del proyecto, paginados (costDate DESC, createdAt DESC, id DESC). Dos consultas (total y página)
   * con joins: sin N+1. Consultas crudas: TypeORM filtra `deleted_at` de los joins a usuarios dados de baja y acá hace falta
   * mostrar igual al creador; por eso `deleted_at IS NULL` de `costs` se escribe explícito.
   */
  async list(projectId: string, query: ListCostsQueryDto, user: RequestUser): Promise<PaginatedResponse<CostResponseDto>> {
    const project = await this.findProjectOrThrow(projectId);
    // RN-25: sin permiso económico → 403, nunca una lista vacía.
    if (!this.permissions.canViewEconomicData(user, project)) {
      throw new ForbiddenException(FORBIDDEN_VIEW_MESSAGE);
    }

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const manager = this.dataSource.manager;

    const [counted]: Array<{ total: number }> = await manager.query(
      'SELECT COUNT(*)::int AS total FROM costs WHERE project_id = $1 AND deleted_at IS NULL',
      [projectId],
    );
    const total = counted!.total;
    const rows: CostRow[] = await manager.query(
      `${COST_SELECT}
        WHERE c.project_id = $1 AND c.deleted_at IS NULL
        ORDER BY c.cost_date DESC, c.created_at DESC, c.id DESC
        LIMIT $2 OFFSET $3`,
      [projectId, limit, (page - 1) * limit],
    );

    return { data: rows.map(toCostResponse), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Detalle de un costo. 404 de proyecto → 403 → 404 COST_NOT_FOUND (inexistente, de otro proyecto o dado de baja: indistinguibles). */
  async getOne(projectId: string, costId: string, user: RequestUser): Promise<CostResponseDto> {
    const project = await this.findProjectOrThrow(projectId);
    if (!this.permissions.canViewEconomicData(user, project)) {
      throw new ForbiddenException(FORBIDDEN_VIEW_MESSAGE);
    }

    // Se consulta por proyecto Y costo: un costo de otro proyecto no se puede ver ni distinguir de uno inexistente.
    const [row]: CostRow[] = await this.dataSource.manager.query(
      `${COST_SELECT} WHERE c.id = $1 AND c.project_id = $2 AND c.deleted_at IS NULL`,
      [costId, projectId],
    );
    if (!row) {
      throw this.costNotFound();
    }
    return toCostResponse(row);
  }

  /**
   * Edición parcial. Orden: proyecto 404 → 403 → [transacción] proyecto FOR SHARE → costo FOR UPDATE (404) → `expectedRevision`
   * (409) → "sin cambios" (409) → rubro / tarea solo si cambian (400) → RN-21 solo si cambia la fecha (409) → UPDATE con
   * revision + 1 → auditoría COST_UPDATED. Todo o nada.
   */
  async update(projectId: string, costId: string, dto: UpdateCostDto, user: RequestUser): Promise<CostResponseDto> {
    const project = await this.findProjectOrThrow(projectId);
    if (!this.permissions.canManageCosts(user, project)) {
      throw new ForbiddenException('No tenés permisos para editar costos en este proyecto.');
    }

    const texts = updateTexts(costId);

    const response = await this.dataSource.transaction(async (manager) => {
      // 1) Proyecto FOR SHARE. La moneda de un costo NO se edita: es la del proyecto. Si el cliente manda otra, 400
      // PROJECT_CURRENCY_MISMATCH; si manda la misma no hay cambio. Nunca se convierte.
      const lockedProject = await this.lockProject(manager, projectId, dto.currency);

      // 2) El costo FOR UPDATE (nunca antes que el proyecto). Con `deleted_at IS NULL`: una baja concurrente da 404 y nunca se revive.
      const current = await this.lockCost(manager, projectId, costId);

      // Optimistic concurrency (RNF-20): ANTES de "sin cambios". Un escritor viejo recibe el conflicto aunque su contenido sea idéntico.
      if (dto.expectedRevision !== current.revision) {
        throw new ConflictException({
          code: 'COST_VERSION_CONFLICT',
          message: 'El costo cambió desde que lo abriste. Volvé a cargarlo antes de editarlo.',
          currentRevision: current.revision,
        });
      }

      const next = resolveNextState(current, dto);
      const changedFields = EDITABLE_FIELDS.filter((field) => next[field] !== current[field]);
      if (changedFields.length === 0) {
        throw new ConflictException({ code: 'COST_NO_CHANGES', message: 'Los datos son idénticos a los del costo actual; no se modificó nada.' });
      }

      // 3) Rubro: solo si CAMBIA (RN-20 completo). Si no cambia no se revalida nada (el costo fue válido al registrarse).
      let categoryName = current.categoryName;
      let categoryValidatedAgainstBudgetVersion: number | null = null;
      if (changedFields.includes('costCategoryId')) {
        const lockedCategory = await this.lockCategory(manager, next.costCategoryId);
        const budget = await this.getCurrentBudgetOrThrow(manager, projectId, texts);
        const category = await this.requireCategoryInBudget(manager, lockedCategory, next.costCategoryId, budget, texts);
        categoryName = category.name;
        categoryValidatedAgainstBudgetVersion = budget.version;
      }

      // Tarea: solo si CAMBIA. null = quitar (siempre válido).
      if (changedFields.includes('taskId') && next.taskId !== null) {
        await this.findTaskTitleInProject(manager, projectId, next.taskId);
      }

      // RN-21 y BUG-10: SOLO si cambia la fecha. Corregir otro dato de un costo histórico fuera del período no vuelve a pedir confirmación.
      // Sin fecha de inicio / de fin no se compara (decisión provisional pendiente de TEMA).
      const confirmations = changedFields.includes('costDate') ? this.checkDateConfirmations(next.costDate, dto, lockedProject, texts) : NO_CONFIRMATIONS;

      const newRevision = await this.updateCostRow(manager, projectId, costId, changedFields, next, current.revision);
      await recordCostUpdated(manager, projectId, costId, user, current, next, categoryName, newRevision, {
        changedFields,
        categoryValidatedAgainstBudgetVersion,
        ...confirmations,
      });

      const [row]: CostRow[] = await manager.query(`${COST_SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL`, [costId]);
      return toCostResponse(row!);
    });
    await this.projectAlerts.checkBudgetAfterCostChange(projectId);
    return response;
  }

  /** 2) El costo con su rubro, FOR UPDATE OF c (importes y fechas como texto). 404 si no existe, es de otro proyecto o está dado de baja. */
  private async lockCost(manager: EntityManager, projectId: string, costId: string): Promise<CurrentCost> {
    const currents: CurrentCost[] = await manager.query(
      `SELECT c.id, c.task_id AS "taskId", c.cost_category_id AS "costCategoryId", cc.name AS "categoryName", c.amount::text AS amount,
              c.currency, c.cost_date::text AS "costDate", c.description, c.revision
         FROM costs c
         JOIN cost_categories cc ON cc.id = c.cost_category_id
        WHERE c.id = $1 AND c.project_id = $2 AND c.deleted_at IS NULL
          FOR UPDATE OF c`,
      [costId, projectId],
    );
    if (!currents[0]) {
      throw this.costNotFound();
    }
    return currents[0];
  }

  /**
   * UPDATE: solo las columnas que cambian + updated_at (instante real de la edición) + revision = revision + 1, en una sola
   * sentencia bajo el lock de la fila. `deleted_at IS NULL` en el WHERE: una baja nunca se revierte desde acá. Devuelve la nueva revisión.
   */
  private async updateCostRow(
    manager: EntityManager,
    projectId: string,
    costId: string,
    changedFields: readonly EditableField[],
    next: CostState,
    currentRevision: number,
  ): Promise<number> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const field of changedFields) {
      values.push(next[field]);
      assignments.push(`${EDITABLE_COLUMNS[field]} = $${values.length}`);
    }
    values.push(costId, projectId);
    const updated: Array<{ revision: number }> = await manager.query(
      `UPDATE costs SET ${assignments.join(', ')}, updated_at = clock_timestamp(), revision = revision + 1
        WHERE id = $${values.length - 1} AND project_id = $${values.length} AND deleted_at IS NULL
      RETURNING revision`,
      values,
    );
    // En el formato de TypeORM para UPDATE ... RETURNING el resultado es [filas, cantidad].
    const newRevision = Array.isArray(updated[0]) ? (updated[0] as unknown as Array<{ revision: number }>)[0]?.revision : updated[0]?.revision;
    if (newRevision !== currentRevision + 1) {
      throw new InternalServerErrorException('No se pudo actualizar el costo.');
    }
    return newRevision;
  }

  private async findProjectOrThrow(projectId: string): Promise<ProjectEntity> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    return project;
  }

  private costNotFound(): NotFoundException {
    return new NotFoundException({ code: 'COST_NOT_FOUND', message: 'El costo no existe en este proyecto.' });
  }
}
