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
import { DataSource, Repository } from 'typeorm';
import type { PaginatedResponse } from '@tema/shared-types';
import { CostEntity } from '../database/entities/cost.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { ProjectEntity } from '../projects/project.entity';
import { AuditEntityType, AuditOrigin } from '../database/enums';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateCostDto } from './dto/create-cost.dto';
import { ListCostsQueryDto } from './dto/list-costs-query.dto';
import { UpdateCostDto } from './dto/update-cost.dto';
import { normalizeAmount } from '../budgets/dto/amount';
import { CostResponseDto, CostRow, toCostResponse } from './dto/cost-response.dto';
import { resolveProjectCurrency } from '../economy/project-currency';

/** `audit_logs.action` es texto libre; misma convención <ENTIDAD>_<VERBO> que BUDGET_CREATED. */
export const COST_CREATED_ACTION = 'COST_CREATED';

export const COST_UPDATED_ACTION = 'COST_UPDATED';

/** Mismos defaults que el listado de tareas. */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

/** Costo + nombres para mostrar. Importes y fechas como texto; `deleted_at IS NULL` lo agrega quien consulta (ver abajo). */
const COST_SELECT = `
  SELECT c.id, c.project_id AS "projectId", c.task_id AS "taskId", t.title AS "taskTitle",
         c.cost_category_id AS "costCategoryId", cc.name AS "categoryName", c.amount::text AS amount, c.currency,
         c.cost_date::text AS "costDate", c.description, c.created_by AS "createdBy", u.name AS "createdByName",
         c.created_at AS "createdAt", c.updated_at AS "updatedAt", c.revision
    FROM costs c
    JOIN cost_categories cc ON cc.id = c.cost_category_id
    JOIN users u ON u.id = c.created_by
    LEFT JOIN tasks t ON t.id = c.task_id`;

/** Campos editables, en el orden determinístico en que se informan en `changedFields` de la auditoría. */
const EDITABLE_FIELDS = ['costDate', 'amount', 'currency', 'costCategoryId', 'description', 'taskId'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];
const EDITABLE_COLUMNS: Record<EditableField, string> = {
  costDate: 'cost_date',
  amount: 'amount',
  currency: 'currency',
  costCategoryId: 'cost_category_id',
  description: 'description',
  taskId: 'task_id',
};

/** Estado actual del costo leído bajo FOR UPDATE (importes y fechas como texto). */
interface CurrentCost {
  id: string;
  taskId: string | null;
  costCategoryId: string;
  categoryName: string;
  amount: string;
  currency: string;
  costDate: string;
  description: string;
  revision: number;
}

/**
 * Costos incurridos de un proyecto (RF-CT-03, RN-19/20/21): alta, listado, detalle y edición parcial con control de
 * concurrencia optimista (`revision`). La BAJA lógica NO está expuesta (COST-DELETE: pendiente de confirmar con TEMA quién puede
 * dar de baja un costo; la matriz solo autoriza registrar y editar).
 *
 * DATOS ECONÓMICOS (RN-25): los importes solo los reciben quienes pasan `canManageCosts` / `canViewEconomicData`
 * (ADMIN, PROGRAM_MANAGER y líder real). La auditoría va a `audit_logs`, NUNCA a `project_activities` (ese feed lo ven
 * todos los miembros). Toda lectura futura de `audit_logs` de tipo COST debe exigir también canViewEconomicData.
 *
 * RN-19 (costo que supera el presupuesto) queda PARCIALMENTE implementada: se cumple "no bloquear" (ningún costo se
 * rechaza por exceder una partida o el total). Señalar y notificar el exceso queda para ECON-01 / ALERT-ECON.
 *
 * MONEDA ÚNICA POR PROYECTO: el costo SIEMPRE se registra en `projects.economic_currency` (la moneda del presupuesto y de las
 * asignaciones de ese proyecto). No hay multimoneda ni conversión: `currency` en el DTO es opcional y, si viene distinta,
 * 400 PROJECT_CURRENCY_MISMATCH; tampoco se puede editar la moneda de un costo.
 *
 * RN-20 (rubro en el presupuesto, interpretación provisional): el rubro debe existir, estar activo y tener una partida en el
 * presupuesto VIGENTE. El flujo "crear rubro" (visible desde Líder, contradice la matriz de presupuesto) lo resuelve CAT-01.
 *
 * PENDIENTES CON TEMA (no se inventa regla): proyecto sin fecha de inicio (hoy no se compara ni se pide confirmación);
 * fecha de costo futura (hoy se acepta); estado del proyecto o de la tarea (hoy sin restricciones); qué hacer al quitar
 * un rubro con costos incurridos al versionar el presupuesto; rubro inactivo que sigue en el presupuesto vigente (hoy se rechaza).
 *
 * EDICIÓN (PATCH): `expectedRevision` se compara DENTRO del lock de la fila y ANTES de "sin cambios"; cada edición suma 1 a
 * `revision` en el mismo UPDATE (nunca un número calculado fuera del lock). El rubro solo se revalida (RN-20) si CAMBIA: un costo
 * histórico se puede corregir aunque después el rubro se haya desactivado o el presupuesto lo haya quitado. RN-21 solo se
 * pide si cambia la fecha. La tarea solo se revalida si cambia. `updated_at` es metadato (clock_timestamp()), no token.
 *
 * ORDEN DE LOCKS (no invertir nunca, evita deadlocks): 1) `projects` FOR SHARE (choca con el FOR UPDATE del versionado de
 * presupuesto, así el presupuesto no cambia mientras se valida; varios costos del mismo proyecto no se esperan entre sí),
 * 2) [solo en la edición] la fila del costo FOR UPDATE, 3) `cost_categories` FOR SHARE (en la edición, solo si cambia el rubro),
 * 4) lecturas del presupuesto vigente, partida y tarea, 5) INSERT/UPDATE del costo, 6) INSERT de la auditoría.
 */
@Injectable()
export class CostsService {
  private readonly logger = new Logger(CostsService.name);

  constructor(
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    private readonly permissions: PermissionsService,
    private readonly dataSource: DataSource,
  ) {}

  /** Registra un costo. 404 de proyecto ANTES que el 403 (los permisos dependen del proyecto, igual que GET /budget). */
  async create(projectId: string, dto: CreateCostDto, user: RequestUser): Promise<CostResponseDto> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    if (!this.permissions.canManageCosts(user, project)) {
      throw new ForbiddenException('No tenés permisos para registrar costos en este proyecto.');
    }

    return this.dataSource.transaction(async (manager) => {
      // 1) Proyecto FOR SHARE. La fecha de inicio se lee BAJO el lock: nadie puede cambiarla mientras se valida.
      const locked: Array<{ startDate: string | null; economicCurrency: string }> = await manager.query(
        'SELECT start_date::text AS "startDate", economic_currency AS "economicCurrency" FROM projects WHERE id = $1 AND deleted_at IS NULL FOR SHARE',
        [projectId],
      );
      if (locked.length === 0) {
        throw new NotFoundException(`Project ${projectId} no encontrado`);
      }
      const projectStartDate = locked[0]!.startDate;
      // Moneda ÚNICA del proyecto (leída bajo el lock FOR SHARE: el cambio de moneda toma FOR UPDATE y espera). El costo siempre
      // se registra en ella; si el cliente mandó otra, 400 PROJECT_CURRENCY_MISMATCH. Nunca se convierte.
      const currency = resolveProjectCurrency(dto.currency, locked[0]!.economicCurrency, 'El costo');

      // 2) Rubro FOR SHARE (nadie lo desactiva entre la validación y el insert).
      const categories: Array<{ id: string; name: string; active: boolean }> = await manager.query(
        'SELECT id, name, active FROM cost_categories WHERE id = $1 FOR SHARE',
        [dto.costCategoryId],
      );
      const category = categories[0];

      // 3) Presupuesto vigente (solo is_current = true; nunca max(version)).
      const budgets: Array<{ id: string; version: number }> = await manager.query(
        'SELECT id, version FROM budgets WHERE project_id = $1 AND is_current = true',
        [projectId],
      );
      const budget = budgets[0];
      if (!budget) {
        const [counted]: Array<{ total: number }> = await manager.query(
          'SELECT COUNT(*)::int AS total FROM budgets WHERE project_id = $1',
          [projectId],
        );
        const total = counted!.total;
        if (total > 0) {
          this.logger.error(`Inconsistencia: el proyecto ${projectId} tiene ${total} versión(es) de presupuesto pero NINGUNA vigente; no se registra el costo.`);
          throw new InternalServerErrorException({
            code: 'BUDGET_NO_CURRENT_VERSION',
            message: 'El proyecto tiene versiones de presupuesto pero ninguna vigente. Hay que corregirlo.',
          });
        }
        throw new ConflictException({
          code: 'PROJECT_HAS_NO_CURRENT_BUDGET',
          message: 'El proyecto no tiene un presupuesto vigente: hay que definirlo antes de registrar costos.',
        });
      }

      // RN-20: rubro existente, activo y con partida en el presupuesto vigente.
      if (!category) {
        throw new BadRequestException({ code: 'COST_CATEGORY_NOT_FOUND', message: 'El rubro no existe.', costCategoryId: dto.costCategoryId });
      }
      if (!category.active) {
        throw new BadRequestException({
          code: 'COST_CATEGORY_INACTIVE',
          message: 'El rubro está inactivo: no se puede usar para registrar costos nuevos.',
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

      // Tarea opcional: debe existir y ser de ESTE proyecto. Un solo error: no revela que el UUID existe en otro proyecto.
      let taskTitle: string | null = null;
      if (dto.taskId) {
        const tasks: Array<{ title: string }> = await manager.query('SELECT title FROM tasks WHERE id = $1 AND project_id = $2', [dto.taskId, projectId]);
        if (tasks.length === 0) {
          throw new BadRequestException({
            code: 'TASK_NOT_AVAILABLE_FOR_PROJECT',
            message: 'La tarea no existe o no pertenece a este proyecto.',
          });
        }
        taskTitle = tasks[0]!.title;
      }

      // RN-21: fecha anterior al inicio del proyecto requiere confirmación explícita. Sin fecha de inicio no se compara.
      // Las fechas YYYY-MM-DD se comparan como texto (orden lexicográfico = cronológico); nunca como Date.
      const beforeStart = projectStartDate !== null && dto.costDate < projectStartDate;
      const confirmedBeforeProjectStart = beforeStart && dto.confirmBeforeProjectStart === true;
      if (beforeStart && !confirmedBeforeProjectStart) {
        throw new ConflictException({
          code: 'COST_BEFORE_PROJECT_START_CONFIRMATION_REQUIRED',
          message: 'La fecha del costo es anterior al inicio del proyecto. Confirmalo explícitamente para registrarlo.',
          costDate: dto.costDate,
          projectStartDate,
        });
      }

      const saved = await manager.save(
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

      await manager.save(
        manager.create(AuditLogEntity, {
          entityType: AuditEntityType.COST,
          entityId: saved.id,
          action: COST_CREATED_ACTION,
          userId: user.id,
          origin: AuditOrigin.UI,
          oldValues: null,
          newValues: {
            projectId,
            taskId: dto.taskId ?? null,
            costCategoryId: category.id,
            categoryName: category.name,
            amount: dto.amount,
            currency,
            costDate: dto.costDate,
            description: dto.description,
            // Versión del presupuesto vigente contra la que se validó el rubro (el costo NO referencia a budgets).
            budgetVersion: budget.version,
            confirmedBeforeProjectStart,
          },
        }),
      );

      const [row]: CostRow[] = await manager.query(`${COST_SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL`, [saved.id]);
      return toCostResponse({ ...row!, taskTitle });
    });
  }

  /**
   * Costos NO eliminados del proyecto, paginados (costDate DESC, createdAt DESC, id DESC). Dos consultas (total y página)
   * con joins: sin N+1. Consultas crudas: TypeORM filtra `deleted_at` de los joins a usuarios dados de baja y acá hace falta
   * mostrar igual al creador; por eso `deleted_at IS NULL` de `costs` se escribe explícito.
   */
  async list(projectId: string, query: ListCostsQueryDto, user: RequestUser): Promise<PaginatedResponse<CostResponseDto>> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    // RN-25: sin permiso económico → 403, nunca una lista vacía.
    if (!this.permissions.canViewEconomicData(user, project)) {
      throw new ForbiddenException('No tenés permisos para ver la información económica de este proyecto.');
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
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    if (!this.permissions.canViewEconomicData(user, project)) {
      throw new ForbiddenException('No tenés permisos para ver la información económica de este proyecto.');
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
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    if (!this.permissions.canManageCosts(user, project)) {
      throw new ForbiddenException('No tenés permisos para editar costos en este proyecto.');
    }

    return this.dataSource.transaction(async (manager) => {
      // 1) Proyecto FOR SHARE (coordina con el FOR UPDATE del versionado de presupuesto; la fecha de inicio se lee bajo el lock).
      const locked: Array<{ startDate: string | null; economicCurrency: string }> = await manager.query(
        'SELECT start_date::text AS "startDate", economic_currency AS "economicCurrency" FROM projects WHERE id = $1 AND deleted_at IS NULL FOR SHARE',
        [projectId],
      );
      if (locked.length === 0) {
        throw new NotFoundException(`Project ${projectId} no encontrado`);
      }
      const projectStartDate = locked[0]!.startDate;
      // La moneda de un costo NO se edita: es la del proyecto. Si el cliente manda otra, 400 PROJECT_CURRENCY_MISMATCH; si manda la
      // misma no hay cambio. Nunca se convierte.
      resolveProjectCurrency(dto.currency, locked[0]!.economicCurrency, 'El costo');

      // 2) El costo FOR UPDATE (nunca antes que el proyecto). Con `deleted_at IS NULL`: una baja concurrente da 404 y nunca se revive.
      const currents: CurrentCost[] = await manager.query(
        `SELECT c.id, c.task_id AS "taskId", c.cost_category_id AS "costCategoryId", cc.name AS "categoryName", c.amount::text AS amount,
                c.currency, c.cost_date::text AS "costDate", c.description, c.revision
           FROM costs c
           JOIN cost_categories cc ON cc.id = c.cost_category_id
          WHERE c.id = $1 AND c.project_id = $2 AND c.deleted_at IS NULL
            FOR UPDATE OF c`,
        [costId, projectId],
      );
      const current = currents[0];
      if (!current) {
        throw this.costNotFound();
      }

      // Optimistic concurrency (RNF-20): ANTES de "sin cambios". Un escritor viejo recibe el conflicto aunque su contenido sea idéntico.
      if (dto.expectedRevision !== current.revision) {
        throw new ConflictException({
          code: 'COST_VERSION_CONFLICT',
          message: 'El costo cambió desde que lo abriste. Volvé a cargarlo antes de editarlo.',
          currentRevision: current.revision,
        });
      }

      // Estado resultante: lo enviado (ya normalizado por el DTO) sobre el costo actual. taskId: omitido = conserva, null = quita.
      // El DTO ya normaliza en el borde HTTP; se repite acá (idempotente) para que la comparación "sin cambios" y lo que se
      // escribe sean SIEMPRE la forma canónica, también si el servicio se llama desde otro lado.
      const next = {
        costDate: dto.costDate !== undefined ? dto.costDate.trim() : current.costDate,
        amount: dto.amount !== undefined ? normalizeAmount(dto.amount.trim()) : current.amount,
        currency: current.currency,
        costCategoryId: dto.costCategoryId !== undefined ? dto.costCategoryId.toLowerCase() : current.costCategoryId,
        description: dto.description !== undefined ? dto.description.trim() : current.description,
        taskId: dto.taskId === undefined ? current.taskId : dto.taskId === null ? null : dto.taskId.toLowerCase(),
      };
      const changedFields = EDITABLE_FIELDS.filter((field) => next[field] !== current[field]);
      if (changedFields.length === 0) {
        throw new ConflictException({ code: 'COST_NO_CHANGES', message: 'Los datos son idénticos a los del costo actual; no se modificó nada.' });
      }

      // 3) Rubro: solo si CAMBIA (RN-20 completo). Si no cambia no se revalida nada (el costo fue válido al registrarse).
      let categoryName = current.categoryName;
      let categoryValidatedAgainstBudgetVersion: number | null = null;
      if (changedFields.includes('costCategoryId')) {
        const categories: Array<{ id: string; name: string; active: boolean }> = await manager.query(
          'SELECT id, name, active FROM cost_categories WHERE id = $1 FOR SHARE',
          [next.costCategoryId],
        );
        const category = categories[0];
        const budgets: Array<{ id: string; version: number }> = await manager.query(
          'SELECT id, version FROM budgets WHERE project_id = $1 AND is_current = true',
          [projectId],
        );
        const budget = budgets[0];
        if (!budget) {
          const [counted]: Array<{ total: number }> = await manager.query('SELECT COUNT(*)::int AS total FROM budgets WHERE project_id = $1', [projectId]);
          if (counted!.total > 0) {
            this.logger.error(`Inconsistencia: el proyecto ${projectId} tiene ${counted!.total} versión(es) de presupuesto pero NINGUNA vigente; no se cambia el rubro del costo ${costId}.`);
            throw new InternalServerErrorException({
              code: 'BUDGET_NO_CURRENT_VERSION',
              message: 'El proyecto tiene versiones de presupuesto pero ninguna vigente. Hay que corregirlo.',
            });
          }
          throw new ConflictException({
            code: 'PROJECT_HAS_NO_CURRENT_BUDGET',
            message: 'El proyecto no tiene un presupuesto vigente: hay que definirlo antes de cambiar el rubro de un costo.',
          });
        }
        if (!category) {
          throw new BadRequestException({ code: 'COST_CATEGORY_NOT_FOUND', message: 'El rubro no existe.', costCategoryId: next.costCategoryId });
        }
        if (!category.active) {
          throw new BadRequestException({
            code: 'COST_CATEGORY_INACTIVE',
            message: 'El rubro está inactivo: no se puede usar para un costo.',
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
        categoryName = category.name;
        categoryValidatedAgainstBudgetVersion = budget.version;
      }

      // Tarea: solo si CAMBIA. null = quitar (siempre válido). Un solo error para inexistente o de otro proyecto.
      if (changedFields.includes('taskId') && next.taskId !== null) {
        const tasks = await manager.query('SELECT 1 FROM tasks WHERE id = $1 AND project_id = $2', [next.taskId, projectId]);
        if (tasks.length === 0) {
          throw new BadRequestException({
            code: 'TASK_NOT_AVAILABLE_FOR_PROJECT',
            message: 'La tarea no existe o no pertenece a este proyecto.',
          });
        }
      }

      // RN-21: SOLO si cambia la fecha. Corregir otro dato de un costo histórico anterior al inicio no vuelve a pedir confirmación.
      // Sin fecha de inicio no se compara (decisión provisional pendiente de TEMA). Fechas como texto YYYY-MM-DD.
      const dateMovedBeforeStart = changedFields.includes('costDate') && projectStartDate !== null && next.costDate < projectStartDate;
      const confirmedBeforeProjectStart = dateMovedBeforeStart && dto.confirmBeforeProjectStart === true;
      if (dateMovedBeforeStart && !confirmedBeforeProjectStart) {
        throw new ConflictException({
          code: 'COST_BEFORE_PROJECT_START_CONFIRMATION_REQUIRED',
          message: 'La fecha del costo es anterior al inicio del proyecto. Confirmalo explícitamente para guardarla.',
          costDate: next.costDate,
          projectStartDate,
        });
      }

      // UPDATE: solo las columnas que cambian + updated_at (instante real de la edición) + revision = revision + 1, en una
      // sola sentencia bajo el lock de la fila. `deleted_at IS NULL` en el WHERE: una baja nunca se revierte desde acá.
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
      if (newRevision !== current.revision + 1) {
        throw new InternalServerErrorException('No se pudo actualizar el costo.');
      }

      const snapshot = (state: typeof next, name: string, revision: number) => ({
        projectId,
        taskId: state.taskId,
        costCategoryId: state.costCategoryId,
        categoryName: name,
        amount: state.amount,
        currency: state.currency,
        costDate: state.costDate,
        description: state.description,
        revision,
      });
      await manager.save(
        manager.create(AuditLogEntity, {
          entityType: AuditEntityType.COST,
          entityId: costId,
          action: COST_UPDATED_ACTION,
          userId: user.id,
          origin: AuditOrigin.UI,
          oldValues: snapshot(current, current.categoryName, current.revision),
          newValues: {
            ...snapshot(next, categoryName, newRevision),
            change: { changedFields, categoryValidatedAgainstBudgetVersion, confirmedBeforeProjectStart },
          },
        }),
      );

      const [row]: CostRow[] = await manager.query(`${COST_SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL`, [costId]);
      return toCostResponse(row!);
    });
  }

  private costNotFound(): NotFoundException {
    return new NotFoundException({ code: 'COST_NOT_FOUND', message: 'El costo no existe en este proyecto.' });
  }
}
