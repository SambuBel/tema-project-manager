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
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { ProjectEntity } from '../projects/project.entity';
import { resolveProjectCurrency } from '../economy/project-currency';
import { AuditEntityType, AuditOrigin } from '../database/enums';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { CreateBudgetVersionDto } from './dto/create-budget-version.dto';
import { BudgetHistoryEntryDto, BudgetResponseDto, toBudgetResponse, toHistoryEntry } from './dto/budget-response.dto';
import { CreateBudgetItemDto } from './dto/create-budget-item.dto';
import { BudgetItemView, isSameSnapshot, sortItems } from './dto/budget-snapshot';
import { currentNotLatestError, noCurrentVersionError } from './budget-integrity.errors';
import { BudgetCode, CostCategoryCode } from './budget-error-codes';
import { assertHistoryIntegrity, integrityFailure } from './budget-integrity';
import { prepareItems } from './budget-items';
import { auditSnapshot } from './budget-audit';
import { insertItems, loadItems, loadItemsByBudget, loadVersionRows } from './budget-persistence';

/** `audit_logs.action` es texto libre; misma convención <ENTIDAD>_<VERBO> que TASK_CREATED, PROJECT_CREATED... */
export const BUDGET_CREATED_ACTION = 'BUDGET_CREATED';
export const BUDGET_VERSION_CREATED_ACTION = 'BUDGET_VERSION_CREATED';

const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Presupuesto de un proyecto, versionado (RN-18): cada versión es un snapshot COMPLETO con sus propias partidas (`budget_items`,
 * inmutables). Modificar = crear una versión nueva; la anterior queda histórica.
 *
 * ORDEN DE LOCKS (no invertir nunca, evita deadlocks): 1) `projects` FOR UPDATE, 2) `cost_categories` necesarias FOR SHARE
 * (impide que otra transacción desactive un rubro entre su validación y el insert), 3) escrituras.
 * INVARIANTE: todo escritor de `budgets` debe tomar el `FOR UPDATE` del proyecto antes de leer/escribir presupuestos. Es lo que
 * serializa altas y versionados.
 *
 * DATOS ECONÓMICOS (RN-25): la auditoría va a `audit_logs` y NO a `project_activities` (ese feed lo ven todos los miembros).
 * Cualquier lectura futura de `audit_logs` de tipo BUDGET debe exigir también `canViewEconomicData`.
 *
 * Reglas funcionales, errores y decisiones abiertas con TEMA: docs/economia-presupuesto.md (moneda: docs/economia-moneda-unica.md).
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

    const items = prepareItems(dto);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const project = await this.lockProject(manager, projectId);
        // Moneda ÚNICA del proyecto, leída BAJO el lock: nadie la cambia mientras se valida y se inserta.
        const currency = resolveProjectCurrency(dto.currency, project.economicCurrency, 'El presupuesto');

        const existing = await manager.count(BudgetEntity, { where: { projectId } });
        if (existing > 0) {
          throw this.alreadyExists();
        }

        // Paso 2 del orden de locks: los rubros se validan ANTES de cualquier escritura.
        const itemViews = await this.lockAndValidateCategories(manager, items);

        const saved = await this.persistVersion(manager, {
          projectId,
          version: 1,
          dto,
          currency,
          itemViews,
          userId: user.id,
          action: BUDGET_CREATED_ACTION,
          oldValues: null,
        });

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

    const items = prepareItems(dto);

    return this.dataSource.transaction(async (manager) => {
      const project = await this.lockProject(manager, projectId);
      // Una versión nueva NO puede cambiar de moneda: siempre es la del proyecto.
      const currency = resolveProjectCurrency(dto.currency, project.economicCurrency, 'El presupuesto');

      const current = await manager.findOne(BudgetEntity, { where: { projectId, isCurrent: true } });
      const [stats]: Array<{ maxVersion: number; total: number }> = await manager.query(
        'SELECT COALESCE(MAX(version), 0)::int AS "maxVersion", COUNT(*)::int AS total FROM budgets WHERE project_id = $1',
        [projectId],
      );
      const { maxVersion, total } = stats!;

      if (!current) {
        if (total === 0) {
          throw new NotFoundException({
            code: BudgetCode.NOT_FOUND,
            message: 'El proyecto todavía no tiene presupuesto. Hay que definir el presupuesto inicial primero.',
          });
        }
        throw integrityFailure(this.logger, 
          `Inconsistencia: el proyecto ${projectId} tiene ${total} versión(es) de presupuesto (máx. ${maxVersion}) pero NINGUNA vigente; no se crea otra versión.`,
          noCurrentVersionError(),
        );
      }

      if (current.version !== maxVersion) {
        throw integrityFailure(this.logger, 
          `Inconsistencia: el proyecto ${projectId} tiene como vigente la versión ${current.version} (${current.id}) pero la versión máxima es ${maxVersion}; no se crea otra versión.`,
          currentNotLatestError(),
        );
      }

      if (current.version !== dto.expectedVersion) {
        throw new ConflictException({
          code: BudgetCode.VERSION_CONFLICT,
          message: 'El presupuesto cambió desde que lo abriste. Volvé a cargarlo antes de modificarlo.',
          currentVersion: current.version,
        });
      }

      // Sin cambios = mismo encabezado Y mismo desglose (conjunto rubro → importe, sin importar el orden del request).
      const currentItems = await loadItems(manager, current.id);
      if (isSameSnapshot({ ...current, items: currentItems }, { ...dto, currency, items })) {
        throw new ConflictException({
          code: BudgetCode.NO_CHANGES,
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

      const saved = await this.persistVersion(manager, {
        projectId,
        version: maxVersion + 1,
        dto,
        currency,
        itemViews,
        userId: user.id,
        action: BUDGET_VERSION_CREATED_ACTION,
        oldValues: auditSnapshot(current, currentItems),
      });

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
    const versions = await loadVersionRows(manager, projectId);

    if (versions.length === 0) {
      throw new NotFoundException({ code: BudgetCode.NOT_FOUND, message: 'El proyecto todavía no tiene presupuesto.' });
    }
    assertHistoryIntegrity(this.logger, projectId, versions);

    const itemsByBudget = await loadItemsByBudget(manager, versions.map((version) => version.id));

    return versions.map((version) => toHistoryEntry(version, itemsByBudget.get(version.id) ?? []));
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
      return toBudgetResponse(current, await loadItems(this.dataSource.manager, current.id));
    }

    const versions = await this.budgetRepo.count({ where: { projectId } });
    if (versions > 0) {
      throw integrityFailure(this.logger, 
        `Inconsistencia: el proyecto ${projectId} tiene ${versions} versión(es) de presupuesto pero NINGUNA vigente (is_current = true).`,
        noCurrentVersionError(),
      );
    }

    throw new NotFoundException({ code: BudgetCode.NOT_FOUND, message: 'El proyecto todavía no tiene presupuesto.' });
  }

  /** Paso 1 del orden de locks: `projects` FOR UPDATE. Serializa a quien cree o versione presupuestos de ESE proyecto. */
  private async lockProject(manager: EntityManager, projectId: string): Promise<{ id: string; economicCurrency: string }> {
    const locked: Array<{ id: string; economicCurrency: string }> = await manager.query(
      'SELECT id, economic_currency AS "economicCurrency" FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [projectId],
    );
    if (locked.length === 0) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    return locked[0]!;
  }

  /** Paso 3: inserta la versión vigente con SUS partidas y su fila de auditoría. Quien llama ya tiene los locks 1 y 2. */
  private async persistVersion(
    manager: EntityManager,
    input: {
      projectId: string;
      version: number;
      dto: CreateBudgetDto;
      currency: string;
      itemViews: BudgetItemView[];
      userId: string;
      action: string;
      oldValues: object | null;
    },
  ): Promise<BudgetEntity> {
    const { projectId, version, dto, currency, itemViews, userId, action, oldValues } = input;
    const saved = await manager.save(
      manager.create(BudgetEntity, {
        projectId,
        version,
        totalAmount: dto.totalAmount,
        currency,
        approvalDate: dto.approvalDate,
        isCurrent: true,
        supersededAt: null,
        createdBy: userId,
      }),
    );
    await insertItems(manager, saved.id, itemViews);

    await manager.save(
      manager.create(AuditLogEntity, {
        entityType: AuditEntityType.BUDGET,
        entityId: saved.id,
        action,
        userId,
        origin: AuditOrigin.UI,
        oldValues,
        newValues: auditSnapshot(saved, itemViews),
      }),
    );
    return saved;
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
        code: CostCategoryCode.NOT_FOUND,
        message: 'Hay rubros que no existen.',
        costCategoryIds: missing,
      });
    }
    const inactive = categories.filter((category) => !category.active);
    if (inactive.length > 0) {
      throw new BadRequestException({
        code: CostCategoryCode.INACTIVE,
        message: 'Hay rubros inactivos: no se pueden usar en presupuestos nuevos.',
        costCategoryIds: inactive.map((category) => category.id),
      });
    }

    return sortItems(items.map((item) => ({ costCategoryId: item.costCategoryId, categoryName: byId.get(item.costCategoryId)!.name, amount: item.amount })));
  }

  private alreadyExists(): ConflictException {
    return new ConflictException({
      code: BudgetCode.ALREADY_EXISTS,
      message: 'El proyecto ya tiene un presupuesto. Para modificarlo hay que crear una nueva versión.',
    });
  }
}
