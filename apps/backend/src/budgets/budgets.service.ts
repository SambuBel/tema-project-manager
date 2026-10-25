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
import { BudgetEntity } from '../database/entities/budget.entity';
import { BudgetItemEntity } from '../database/entities/budget-item.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { ProjectEntity } from '../projects/project.entity';
import { AuditEntityType, AuditOrigin } from '../database/enums';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { CreateBudgetVersionDto } from './dto/create-budget-version.dto';
import { BudgetHistoryEntryDto, BudgetResponseDto, toBudgetResponse } from './dto/budget-response.dto';
import { CreateBudgetItemDto } from './dto/create-budget-item.dto';
import { normalizeAmount } from './dto/amount';
import { BudgetItemView, isSameSnapshot, itemsTotal, sortItems } from './dto/budget-snapshot';

/** `audit_logs.action` es texto libre; misma convención <ENTIDAD>_<VERBO> que TASK_CREATED, PROJECT_CREATED... */
export const BUDGET_CREATED_ACTION = 'BUDGET_CREATED';
export const BUDGET_VERSION_CREATED_ACTION = 'BUDGET_VERSION_CREATED';

const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Presupuesto de un proyecto (RF-CT-01 / RF-CT-02 / RN-18): presupuesto inicial (versión 1), nuevas versiones y lectura del
 * vigente, cada una con su desglose por rubro (partidas). Cada request es un snapshot económico COMPLETO: no se hereda nada
 * de la versión anterior y cada versión tiene sus propias filas de `budget_items` (nunca se reutilizan ni se modifican).
 * El historial (`getHistory`) lee budgets + budget_items; los costos y el resto del módulo económico son tareas aparte.
 *
 * ORDEN DE LOCKS (no invertir nunca, evita deadlocks): 1) `projects` FOR UPDATE, 2) `cost_categories` necesarias FOR SHARE
 * (impide que otra transacción desactive un rubro entre su validación y el insert), 3) escrituras.
 *
 * DECISIÓN FUNCIONAL PENDIENTE DE TEMA: la igualdad exacta SUM(items) = totalAmount es una interpretación adoptada a partir
 * del concepto de "desglose"; el documento no la define explícitamente.
 *
 * INVARIANTE DE LOCK: todo escritor de `budgets` debe tomar `SELECT … FROM projects … FOR UPDATE` del proyecto antes de
 * leer/escribir presupuestos. Es lo que serializa altas y versionados; PRES-04 en adelante debe respetarlo.
 *
 * DATOS ECONÓMICOS (RN-25): los importes solo los reciben ADMIN/PROGRAM_MANAGER (alta) y quien pasa
 * `canViewEconomicData` (lectura). Por eso la auditoría va a `audit_logs` y NO a `project_activities` (ese feed lo ven
 * todos los miembros). Cualquier lectura futura de `audit_logs` de tipo BUDGET debe exigir también canViewEconomicData.
 *
 * Pendientes funcionales a validar con TEMA (no hay regla definida, por eso no se restringe nada todavía):
 *  - si un proyecto archivado / finalizado / cancelado puede recibir presupuesto (hoy: sí, mientras exista);
 *  - si la fecha de aprobación puede ser futura (hoy: sí);
 *  - qué monedas se habilitan en el MVP (hoy: cualquier código de 3 letras mayúsculas, formato exigido por la base);
 *  - CAMBIO DE MONEDA entre versiones: hoy se permite (V1 en ARS → V2 en USD). La versión nueva debe reenviar TODAS sus
 *    partidas en la moneda nueva; no se convierte nada ni se usa exchange_rates, y la versión anterior queda íntegra en su
 *    moneda. Antes de permitirlo cuando existan COSTOS cargados (COST-01) hay que definir su interacción con FX-01.
 */
@Injectable()
export class BudgetsService {
  private readonly logger = new Logger(BudgetsService.name);

  constructor(
    @InjectRepository(BudgetEntity) private readonly budgetRepo: Repository<BudgetEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    private readonly permissions: PermissionsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Crea el presupuesto inicial (versión 1, vigente). Solo ADMIN/PROGRAM_MANAGER, verificado ANTES de buscar el
   * proyecto para no revelar si existe. Todo en una transacción: bloqueo de la fila del proyecto (serializa a quien cree
   * o versione presupuestos de ESE proyecto), verificación de que no hay ninguna versión, inserción del presupuesto y de
   * su fila de auditoría. Si algo falla, no queda nada. UNIQUE(project_id, version) es la red de seguridad.
   */
  async create(projectId: string, dto: CreateBudgetDto, user: RequestUser): Promise<BudgetResponseDto> {
    if (!this.permissions.canDefineBudget(user)) {
      throw new ForbiddenException('No tenés permisos para definir el presupuesto de un proyecto.');
    }

    const items = this.prepareItems(dto);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const locked: Array<{ id: string }> = await manager.query(
          'SELECT id FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
          [projectId],
        );
        if (locked.length === 0) {
          throw new NotFoundException(`Project ${projectId} no encontrado`);
        }

        const existing = await manager.count(BudgetEntity, { where: { projectId } });
        if (existing > 0) {
          throw this.alreadyExists();
        }

        // Paso 2 del orden de locks: los rubros se validan ANTES de cualquier escritura.
        const itemViews = await this.lockAndValidateCategories(manager, items);

        const saved = await manager.save(
          manager.create(BudgetEntity, {
            projectId,
            version: 1,
            totalAmount: dto.totalAmount,
            currency: dto.currency,
            approvalDate: dto.approvalDate,
            isCurrent: true,
            supersededAt: null,
            createdBy: user.id,
          }),
        );
        await this.insertItems(manager, saved.id, itemViews);

        await manager.save(
          manager.create(AuditLogEntity, {
            entityType: AuditEntityType.BUDGET,
            entityId: saved.id,
            action: BUDGET_CREATED_ACTION,
            userId: user.id,
            origin: AuditOrigin.UI,
            oldValues: null,
            newValues: this.auditSnapshot(saved, itemViews),
          }),
        );

        return toBudgetResponse(saved, itemViews);
      });
    } catch (error) {
      // Dos altas simultáneas: el lock normalmente las ordena; si igual chocara la unicidad, es el mismo 409.
      if ((error as { driverError?: { code?: string } }).driverError?.code === POSTGRES_UNIQUE_VIOLATION) {
        throw this.alreadyExists();
      }
      throw error;
    }
  }

  /**
   * Nueva versión del presupuesto (RN-18). La vigente pasa a histórica y se inserta la siguiente, todo en UNA transacción
   * bajo el lock del proyecto: ningún lector ve cero ni dos vigentes. La versión anterior es inmutable salvo `is_current`
   * y `superseded_at` (el UPDATE toca solo esas dos columnas). Optimistic concurrency (RNF-20): `expectedVersion` debe ser
   * la vigente, verificado DENTRO del lock; si no, 409 BUDGET_VERSION_CONFLICT. El UPDATE va antes del INSERT porque el
   * índice único parcial de "una vigente por proyecto" no es diferible.
   */
  async createVersion(projectId: string, dto: CreateBudgetVersionDto, user: RequestUser): Promise<BudgetResponseDto> {
    if (!this.permissions.canDefineBudget(user)) {
      throw new ForbiddenException('No tenés permisos para modificar el presupuesto de un proyecto.');
    }

    const items = this.prepareItems(dto);

    return this.dataSource.transaction(async (manager) => {
      const locked: Array<{ id: string }> = await manager.query(
        'SELECT id FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [projectId],
      );
      if (locked.length === 0) {
        throw new NotFoundException(`Project ${projectId} no encontrado`);
      }

      const current = await manager.findOne(BudgetEntity, { where: { projectId, isCurrent: true } });
      const [stats]: Array<{ maxVersion: number; total: number }> = await manager.query(
        'SELECT COALESCE(MAX(version), 0)::int AS "maxVersion", COUNT(*)::int AS total FROM budgets WHERE project_id = $1',
        [projectId],
      );
      const { maxVersion, total } = stats!;

      if (!current) {
        if (total === 0) {
          throw new NotFoundException({
            code: 'BUDGET_NOT_FOUND',
            message: 'El proyecto todavía no tiene presupuesto. Hay que definir el presupuesto inicial primero.',
          });
        }
        this.logger.error(
          `Inconsistencia: el proyecto ${projectId} tiene ${total} versión(es) de presupuesto (máx. ${maxVersion}) pero NINGUNA vigente; no se crea otra versión.`,
        );
        throw new InternalServerErrorException({
          code: 'BUDGET_NO_CURRENT_VERSION',
          message: 'El proyecto tiene versiones de presupuesto pero ninguna vigente. Hay que corregirlo.',
        });
      }

      if (current.version !== maxVersion) {
        this.logger.error(
          `Inconsistencia: el proyecto ${projectId} tiene como vigente la versión ${current.version} (${current.id}) pero la versión máxima es ${maxVersion}; no se crea otra versión.`,
        );
        throw new InternalServerErrorException({
          code: 'BUDGET_VERSION_STATE_INVALID',
          message: 'La versión vigente del presupuesto no es la de mayor número. Hay que corregirlo.',
        });
      }

      if (current.version !== dto.expectedVersion) {
        throw new ConflictException({
          code: 'BUDGET_VERSION_CONFLICT',
          message: 'El presupuesto cambió desde que lo abriste. Volvé a cargarlo antes de modificarlo.',
          currentVersion: current.version,
        });
      }

      // Sin cambios = mismo encabezado Y mismo desglose (conjunto rubro → importe, sin importar el orden del request).
      const currentItems = await this.loadItems(manager, current.id);
      if (isSameSnapshot({ ...current, items: currentItems }, { ...dto, items })) {
        throw new ConflictException({
          code: 'BUDGET_NO_CHANGES',
          message: 'Los datos son idénticos a los del presupuesto vigente; no se creó una versión nueva.',
        });
      }

      // Paso 2 del orden de locks. Los rubros se validan antes de tocar la versión vigente.
      const itemViews = await this.lockAndValidateCategories(manager, items);

      // Única modificación permitida sobre la versión anterior: is_current y superseded_at (sus partidas no se tocan).
      const superseded = await manager
        .createQueryBuilder()
        .update(BudgetEntity)
        .set({ isCurrent: false, supersededAt: () => 'now()' })
        .where('id = :id AND is_current = true', { id: current.id })
        .execute();
      if (superseded.affected !== 1) {
        throw new InternalServerErrorException('No se pudo reemplazar la versión vigente del presupuesto.');
      }

      const saved = await manager.save(
        manager.create(BudgetEntity, {
          projectId,
          version: maxVersion + 1,
          totalAmount: dto.totalAmount,
          currency: dto.currency,
          approvalDate: dto.approvalDate,
          isCurrent: true,
          supersededAt: null,
          createdBy: user.id,
        }),
      );
      await this.insertItems(manager, saved.id, itemViews);

      await manager.save(
        manager.create(AuditLogEntity, {
          entityType: AuditEntityType.BUDGET,
          entityId: saved.id,
          action: BUDGET_VERSION_CREATED_ACTION,
          userId: user.id,
          origin: AuditOrigin.UI,
          oldValues: this.auditSnapshot(current, currentItems),
          newValues: this.auditSnapshot(saved, itemViews),
        }),
      );

      return toBudgetResponse(saved, itemViews);
    });
  }

  /**
   * Historial COMPLETO del presupuesto (RN-18 / RF-CT-13): todas las versiones, de la más nueva a la más vieja, cada una con
   * SUS propias partidas (nunca reconstruidas con datos actuales ni filtradas por rubro activo) y su creador. La fuente es
   * `budgets` + `budget_items`; `audit_logs` NO se lee (es trazabilidad, no el estado histórico).
   *
   * Dos consultas, sin N+1: versiones (con el nombre del creador, aunque esté dado de baja) y las partidas de TODAS ellas.
   * Si el estado es imposible (ninguna vigente, más de una, o la vigente no es la de mayor número) NO se devuelve nada: se
   * loguea y se responde 500 con código, sin corregir ni inferir cuál debería ser la vigente.
   */
  async getHistory(projectId: string, user: RequestUser): Promise<BudgetHistoryEntryDto[]> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    // RN-25: sin permiso económico → 403, nunca [] ni 404 ni datos parciales.
    if (!this.permissions.canViewEconomicData(user, project)) {
      throw new ForbiddenException('No tenés permisos para ver la información económica de este proyecto.');
    }

    const manager = this.dataSource.manager;
    const versions: Array<{
      id: string;
      projectId: string;
      version: number;
      totalAmount: string;
      currency: string;
      approvalDate: string;
      isCurrent: boolean;
      supersededAt: Date | null;
      createdBy: string;
      createdAt: Date;
      createdByName: string;
    }> = await manager.query(
      `SELECT b.id, b.project_id AS "projectId", b.version, b.total_amount::text AS "totalAmount", b.currency,
              b.approval_date::text AS "approvalDate", b.is_current AS "isCurrent", b.superseded_at AS "supersededAt",
              b.created_by AS "createdBy", b.created_at AS "createdAt", u.name AS "createdByName"
         FROM budgets b
         JOIN users u ON u.id = b.created_by
        WHERE b.project_id = $1
        ORDER BY b.version DESC`,
      [projectId],
    );

    if (versions.length === 0) {
      throw new NotFoundException({ code: 'BUDGET_NOT_FOUND', message: 'El proyecto todavía no tiene presupuesto.' });
    }
    this.assertHistoryIntegrity(projectId, versions);

    const itemRows: Array<BudgetItemView & { budgetId: string }> = await manager.query(
      `SELECT bi.budget_id AS "budgetId", bi.cost_category_id AS "costCategoryId", cc.name AS "categoryName", bi.amount::text AS amount
         FROM budget_items bi
         JOIN cost_categories cc ON cc.id = bi.cost_category_id
        WHERE bi.budget_id = ANY($1::uuid[])`,
      [versions.map((version) => version.id)],
    );
    const itemsByBudget = new Map<string, BudgetItemView[]>();
    for (const { budgetId, ...item } of itemRows) {
      itemsByBudget.set(budgetId, [...(itemsByBudget.get(budgetId) ?? []), item]);
    }

    return versions.map((version) => ({
      id: version.id,
      projectId: version.projectId,
      version: version.version,
      totalAmount: version.totalAmount,
      currency: version.currency,
      approvalDate: version.approvalDate,
      isCurrent: version.isCurrent,
      supersededAt: version.supersededAt ? new Date(version.supersededAt).toISOString() : null,
      createdBy: version.createdBy,
      createdAt: new Date(version.createdAt).toISOString(),
      items: sortItems(itemsByBudget.get(version.id) ?? []),
      createdByUser: { id: version.createdBy, name: version.createdByName },
    }));
  }

  /** Estados imposibles del historial: se reportan, nunca se corrigen ni se infiere cuál sería la vigente. */
  private assertHistoryIntegrity(projectId: string, versions: Array<{ id: string; version: number; isCurrent: boolean }>): void {
    const current = versions.filter((version) => version.isCurrent);
    const maxVersion = Math.max(...versions.map((version) => version.version));

    if (current.length === 0) {
      this.logger.error(`Inconsistencia: el proyecto ${projectId} tiene ${versions.length} versión(es) de presupuesto (máx. ${maxVersion}) pero NINGUNA vigente.`);
      throw new InternalServerErrorException({
        code: 'BUDGET_NO_CURRENT_VERSION',
        message: 'El proyecto tiene versiones de presupuesto pero ninguna vigente. Hay que corregirlo.',
      });
    }
    if (current.length > 1) {
      this.logger.error(`Inconsistencia: el proyecto ${projectId} tiene ${current.length} versiones vigentes (${current.map((c) => c.version).join(', ')}).`);
      throw new InternalServerErrorException({
        code: 'BUDGET_VERSION_STATE_INVALID',
        message: 'El proyecto tiene más de una versión vigente del presupuesto. Hay que corregirlo.',
      });
    }
    if (current[0]!.version !== maxVersion) {
      this.logger.error(`Inconsistencia: el proyecto ${projectId} tiene como vigente la versión ${current[0]!.version} (${current[0]!.id}) pero la versión máxima es ${maxVersion}.`);
      throw new InternalServerErrorException({
        code: 'BUDGET_VERSION_STATE_INVALID',
        message: 'La versión vigente del presupuesto no es la de mayor número. Hay que corregirlo.',
      });
    }
  }

  /**
   * Presupuesto VIGENTE del proyecto: filtra EXCLUSIVAMENTE por is_current = true (nunca max(version) ni "el último").
   * Si hay versiones pero ninguna vigente, es una inconsistencia de datos: se reporta (log + 500 con código) y NO se
   * elige ninguna automáticamente.
   */
  async getCurrent(projectId: string, user: RequestUser): Promise<BudgetResponseDto> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    // RN-25: COLLABORATOR / OBSERVER / líder ajeno no reciben información económica ni siquiera como "no hay presupuesto".
    if (!this.permissions.canViewEconomicData(user, project)) {
      throw new ForbiddenException('No tenés permisos para ver la información económica de este proyecto.');
    }

    const current = await this.budgetRepo.findOneBy({ projectId, isCurrent: true });
    if (current) {
      // Las partidas de una versión son inmutables: leerlas en una consulta aparte es consistente. Se listan con el nombre
      // del rubro aunque hoy esté inactivo (no se filtra por `active`).
      return toBudgetResponse(current, await this.loadItems(this.dataSource.manager, current.id));
    }

    const versions = await this.budgetRepo.count({ where: { projectId } });
    if (versions > 0) {
      this.logger.error(
        `Inconsistencia: el proyecto ${projectId} tiene ${versions} versión(es) de presupuesto pero NINGUNA vigente (is_current = true).`,
      );
      throw new InternalServerErrorException({
        code: 'BUDGET_NO_CURRENT_VERSION',
        message: 'El proyecto tiene versiones de presupuesto pero ninguna vigente. Hay que corregirlo.',
      });
    }

    throw new NotFoundException({ code: 'BUDGET_NOT_FOUND', message: 'El proyecto todavía no tiene presupuesto.' });
  }

  /**
   * Validaciones del desglose que no necesitan la base (se hacen antes de abrir la transacción): sin rubros repetidos y
   * SUM(partidas) == totalAmount con aritmética exacta en centavos (BigInt, nunca Number).
   */
  private prepareItems(dto: CreateBudgetDto): CreateBudgetItemDto[] {
    const items = dto.items.map((item) => ({ costCategoryId: item.costCategoryId, amount: normalizeAmount(item.amount) }));

    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const item of items) {
      if (seen.has(item.costCategoryId)) repeated.add(item.costCategoryId);
      seen.add(item.costCategoryId);
    }
    if (repeated.size > 0) {
      throw new BadRequestException({
        code: 'BUDGET_ITEM_DUPLICATED_CATEGORY',
        message: 'Hay rubros repetidos en el desglose. Cada rubro puede aparecer una sola vez.',
        costCategoryIds: [...repeated],
      });
    }

    const total = itemsTotal(items);
    if (total !== dto.totalAmount) {
      throw new BadRequestException({
        code: 'BUDGET_ITEMS_TOTAL_MISMATCH',
        message: 'La suma de las partidas debe ser igual al importe total del presupuesto.',
        totalAmount: dto.totalAmount,
        itemsTotal: total,
      });
    }
    return items;
  }

  /**
   * Bloquea (FOR SHARE, en orden de id) y valida los rubros del request: todos deben existir y estar activos. Debe llamarse
   * DESPUÉS del lock del proyecto. Devuelve las partidas con el nombre del rubro, ordenadas de forma estable.
   */
  private async lockAndValidateCategories(manager: EntityManager, items: CreateBudgetItemDto[]): Promise<BudgetItemView[]> {
    const ids = items.map((item) => item.costCategoryId);
    const categories: Array<{ id: string; name: string; active: boolean }> = await manager.query(
      'SELECT id, name, active FROM cost_categories WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE',
      [ids],
    );
    const byId = new Map(categories.map((category) => [category.id, category]));

    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'COST_CATEGORY_NOT_FOUND',
        message: 'Hay rubros que no existen.',
        costCategoryIds: missing,
      });
    }
    const inactive = categories.filter((category) => !category.active);
    if (inactive.length > 0) {
      throw new BadRequestException({
        code: 'COST_CATEGORY_INACTIVE',
        message: 'Hay rubros inactivos: no se pueden usar en presupuestos nuevos.',
        costCategoryIds: inactive.map((category) => category.id),
      });
    }

    return sortItems(items.map((item) => ({ costCategoryId: item.costCategoryId, categoryName: byId.get(item.costCategoryId)!.name, amount: item.amount })));
  }

  /** Cada versión inserta sus PROPIAS filas (ids nuevos); jamás se reutilizan ni se mueven las de otra versión. */
  private async insertItems(manager: EntityManager, budgetId: string, items: BudgetItemView[]): Promise<void> {
    await manager.insert(
      BudgetItemEntity,
      items.map((item) => ({ budgetId, costCategoryId: item.costCategoryId, amount: item.amount })),
    );
  }

  /** Partidas de una versión con el nombre del rubro (activo o no), en orden estable. */
  private async loadItems(manager: EntityManager, budgetId: string): Promise<BudgetItemView[]> {
    const rows: BudgetItemView[] = await manager.query(
      `SELECT bi.cost_category_id AS "costCategoryId", cc.name AS "categoryName", bi.amount::text AS amount
         FROM budget_items bi
         JOIN cost_categories cc ON cc.id = bi.cost_category_id
        WHERE bi.budget_id = $1`,
      [budgetId],
    );
    return sortItems(rows);
  }

  /**
   * Snapshot para audit_logs (una sola fila por operación). Importes como string; el nombre del rubro va desnormalizado
   * para preservar la interpretación histórica aunque el catálogo cambie. Las auditorías anteriores a PRES-04 no tienen `items`.
   */
  private auditSnapshot(budget: BudgetEntity, items: BudgetItemView[]) {
    return {
      budgetId: budget.id,
      projectId: budget.projectId,
      version: budget.version,
      totalAmount: budget.totalAmount,
      currency: budget.currency,
      approvalDate: budget.approvalDate,
      items: items.map((item) => ({ costCategoryId: item.costCategoryId, categoryName: item.categoryName, amount: item.amount })),
    };
  }

  private alreadyExists(): ConflictException {
    return new ConflictException({
      code: 'BUDGET_ALREADY_EXISTS',
      message: 'El proyecto ya tiene un presupuesto. Para modificarlo hay que crear una nueva versión.',
    });
  }
}
