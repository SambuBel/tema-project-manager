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
import type {
  MemberResourceAllocation,
  MemberResourceAllocationHistoryEntry,
  ProjectResourceAllocationSummary,
} from '@tema/shared-types';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectSlugHistoryEntity } from '../projects/project-slug-history.entity';
import { AuditOrigin } from '../database/enums';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { UpdateMemberResourceAllocationDto } from './dto/update-member-resource-allocation.dto';
import { calculateEstimatedCost, normalizeHours, sumEstimatedCosts } from './dto/estimated-cost';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fila de la asignación vigente / histórica con nombres resueltos por join (importes y fechas como texto). */
interface AllocationRow {
  projectMemberId: string;
  userId: string;
  userName: string;
  revision: number | null;
  isCurrent: boolean | null;
  resourceProfileId: string | null;
  profileName: string | null;
  hourlyCost: string | null;
  currency: string | null;
  estimatedHours: string | null;
  estimatedCost: string | null;
  budgetId: string | null;
  budgetVersion: number | null;
  createdAt: Date | string | null;
  supersededAt: Date | string | null;
  origin: string | null;
  changedById: string | null;
  changedByName: string | null;
}

/** Última revisión vigente de un miembro, leída bajo el lock del miembro. */
interface CurrentAllocation {
  revision: number;
  resourceProfileId: string | null;
  profileName: string | null;
  hourlyCost: string | null;
  currency: string | null;
  estimatedHours: string | null;
}

const ALLOCATION_COLUMNS = `
  pm.id AS "projectMemberId", u.id AS "userId", u.name AS "userName",
  a.revision, a.is_current AS "isCurrent", a.resource_profile_id AS "resourceProfileId", a.profile_name_snapshot AS "profileName",
  a.hourly_cost_snapshot::text AS "hourlyCost", a.currency_snapshot AS currency, a.estimated_hours::text AS "estimatedHours",
  a.estimated_cost_snapshot::text AS "estimatedCost", a.budget_id AS "budgetId", b.version AS "budgetVersion",
  a.created_at AS "createdAt", a.superseded_at AS "supersededAt", a.origin::text AS origin,
  cu.id AS "changedById", cu.name AS "changedByName"`;

/**
 * Asignación versionada de perfiles de recurso a miembros del proyecto y costo estimado de RRHH (RF-CT-06 / RF-CT-07, RN-24).
 *
 * MODELO: `project_member_allocations` es la ÚNICA fuente de verdad económica y el historial funcional (revisiones inmutables).
 * `project_members` es solo organizativo, así que GET /projects/:id/members no puede filtrar tarifas ni horas (RN-25 por construcción).
 *
 * SNAPSHOT (decisión definitiva): perfil, nombre, tarifa y moneda se copian del catálogo al asignar o CAMBIAR de perfil y quedan
 * congelados. Cambiar solo las horas conserva la tarifa del snapshot (120 h × 50 = 6000, aunque el catálogo ya diga 60).
 * Reenviar el mismo perfil NO refresca la tarifa; "actualizar a la tarifa vigente" sería una acción explícita futura. Un perfil
 * que después se desactiva no impide editar las horas; solo no se puede ASIGNAR (o cambiar hacia) un perfil inactivo.
 *
 * CÁLCULO: costo = horas × tarifa del snapshot, redondeado HALF-UP a 2 decimales POR ASIGNACIÓN (ver estimated-cost.ts); los
 * totales por moneda suman esos importes ya redondeados. Se guarda el resultado (la base exige que coincida con sus insumos).
 * Perfil y horas son independientes: sin ambos, el costo es NULL (nunca 0). Sin conversiones: el perfil asignado tiene SIEMPRE la moneda del proyecto (RESOURCE_PROFILE_CURRENCY_MISMATCH si no), así que `totalsByCurrency` tiene como máximo una línea.
 *
 * PRESUPUESTO: cada revisión registra `budget_id` (el vigente en ese instante; la versión sale por join). Sin presupuesto →
 * NULL (no bloquea). Versiones pero ninguna vigente → 500 BUDGET_NO_CURRENT_VERSION (no se oculta la inconsistencia).
 *
 * CONCURRENCIA (RNF-20): `expectedRevision` (0 = todavía no hay asignación). Orden de locks, que no se invierte nunca:
 * 1) `projects` FOR SHARE (choca con el FOR UPDATE del versionado de presupuesto: el presupuesto registrado es exacto),
 * 2) `project_members` FOR UPDATE, 3) asignación vigente, 4) `expectedRevision`, 5) `resource_profiles` FOR SHARE solo si cambia
 * el perfil (una desactivación concurrente espera o gana), 6) presupuesto vigente, 7) la vigente pasa a histórica, 8) se inserta
 * la nueva. El UPDATE va antes del INSERT porque el índice único parcial de "una vigente por miembro" no es diferible.
 *
 * TRAZABILIDAD (RNF-18): `changed_by`, `created_at` y `origin` de cada revisión; NO se duplica en `audit_logs` ni se escribe
 * nada en `project_activities` (ese feed lo ven todos los miembros: RN-25).
 *
 * PENDIENTES CON TEMA: re-alta de un miembro (hoy conserva su asignación vigente, sin refrescar tarifa); si COLLABORATOR puede ver
 * el nombre del perfil sin datos económicos (hoy no ve nada); acción explícita "actualizar a la tarifa vigente"; y una referencia
 * semántica estable al rubro "Recursos humanos" (NO se busca por nombre) para comparar con el presupuesto en ECON-01.
 */
@Injectable()
export class ResourceAllocationsService {
  private readonly logger = new Logger(ResourceAllocationsService.name);

  constructor(
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ProjectSlugHistoryEntity) private readonly slugHistoryRepo: Repository<ProjectSlugHistoryEntity>,
    private readonly permissions: PermissionsService,
    private readonly dataSource: DataSource,
  ) {}

  /** Asignación vigente de cada miembro ACTIVO y totales por moneda (sin conversión). 404 de proyecto → 403 (nunca datos parciales). */
  async getCurrent(idOrSlug: string, user: RequestUser): Promise<ProjectResourceAllocationSummary> {
    const project = await this.resolveProject(idOrSlug);
    this.assertCanView(user, project);

    const rows: AllocationRow[] = await this.dataSource.manager.query(
      `SELECT ${ALLOCATION_COLUMNS}
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id
         LEFT JOIN project_member_allocations a ON a.project_member_id = pm.id AND a.is_current
         LEFT JOIN budgets b ON b.id = a.budget_id
         LEFT JOIN users cu ON cu.id = a.changed_by
        WHERE pm.project_id = $1 AND pm.removed_at IS NULL
        ORDER BY lower(u.name) ASC, pm.joined_at ASC, pm.id ASC`,
      [project.id],
    );
    const members = rows.map((row) => this.toMemberAllocation(row));

    // Los totales salen de las MISMAS filas devueltas (importes ya redondeados, suma exacta): lo mostrado siempre suma el total.
    const byCurrency = new Map<string, string[]>();
    for (const member of members) {
      const cost = member.allocation?.estimatedResourceCost;
      if (cost) byCurrency.set(cost.currency, [...(byCurrency.get(cost.currency) ?? []), cost.amount]);
    }
    const totalsByCurrency = [...byCurrency.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([currency, amounts]) => ({ currency, amount: sumEstimatedCosts(amounts) }));

    return { members, totalsByCurrency };
  }

  /**
   * TODAS las revisiones del miembro (revision DESC), aun si ya fue dado de baja. Solo lee snapshots: no consulta el catálogo
   * de perfiles. Un miembro sin asignaciones devuelve [].
   */
  async getHistory(idOrSlug: string, memberId: string, user: RequestUser): Promise<MemberResourceAllocationHistoryEntry[]> {
    const project = await this.resolveProject(idOrSlug);
    this.assertCanView(user, project);

    const members: Array<{ id: string }> = await this.dataSource.manager.query(
      'SELECT id FROM project_members WHERE id = $1 AND project_id = $2',
      [memberId, project.id],
    );
    if (members.length === 0) throw this.memberNotFound(memberId);

    const rows: AllocationRow[] = await this.dataSource.manager.query(
      `SELECT ${ALLOCATION_COLUMNS}
         FROM project_member_allocations a
         JOIN project_members pm ON pm.id = a.project_member_id
         JOIN users u ON u.id = pm.user_id
         LEFT JOIN budgets b ON b.id = a.budget_id
         LEFT JOIN users cu ON cu.id = a.changed_by
        WHERE a.project_member_id = $1
        ORDER BY a.revision DESC`,
      [memberId],
    );
    return rows.map((row) => ({
      revision: row.revision!,
      isCurrent: row.isCurrent!,
      resourceProfileId: row.resourceProfileId,
      profileNameSnapshot: row.profileName,
      hourlyCostSnapshot: row.hourlyCost,
      currencySnapshot: row.currency,
      estimatedHours: row.estimatedHours,
      estimatedCostSnapshot: row.estimatedCost,
      budgetId: row.budgetId,
      budgetVersion: row.budgetVersion,
      changedBy: { id: row.changedById!, name: row.changedByName! },
      createdAt: this.iso(row.createdAt!),
      supersededAt: row.supersededAt ? this.iso(row.supersededAt) : null,
      origin: row.origin!,
    }));
  }

  /** Crea una revisión nueva de la asignación. 404 de proyecto → 403 → [transacción] (ver el orden de locks en la documentación de la clase). */
  async update(idOrSlug: string, memberId: string, dto: UpdateMemberResourceAllocationDto, user: RequestUser): Promise<MemberResourceAllocation> {
    const project = await this.resolveProject(idOrSlug);
    if (!this.permissions.canManageResourceAllocation(user, project)) {
      throw new ForbiddenException('No tenés permisos para administrar la asignación de recursos de este proyecto.');
    }

    return this.dataSource.transaction(async (manager) => {
      // 1) Proyecto FOR SHARE: coordina con el FOR UPDATE del versionado de presupuesto.
      const locked: Array<{ economicCurrency: string }> = await manager.query(
        'SELECT economic_currency AS "economicCurrency" FROM projects WHERE id = $1 AND deleted_at IS NULL FOR SHARE',
        [project.id],
      );
      if (locked.length === 0) throw new NotFoundException(`Project ${idOrSlug} no encontrado`);
      // Moneda ÚNICA del proyecto, leída bajo el lock: el cambio de moneda toma FOR UPDATE y espera a esta transacción.
      const projectCurrency = locked[0]!.economicCurrency;

      // 2) El miembro FOR UPDATE (solo activos): serializa a todos los escritores de este miembro, también la primera asignación.
      const members = await manager.query('SELECT id FROM project_members WHERE id = $1 AND project_id = $2 AND removed_at IS NULL FOR UPDATE', [memberId, project.id]);
      if (members.length === 0) throw this.memberNotFound(memberId);

      // 3) Asignación vigente (puede no existir).
      const currents: CurrentAllocation[] = await manager.query(
        `SELECT revision, resource_profile_id AS "resourceProfileId", profile_name_snapshot AS "profileName", hourly_cost_snapshot::text AS "hourlyCost",
                currency_snapshot AS currency, estimated_hours::text AS "estimatedHours"
           FROM project_member_allocations WHERE project_member_id = $1 AND is_current`,
        [memberId],
      );
      const current = currents[0] ?? null;
      const currentRevision = current?.revision ?? 0;

      // 4) Optimistic concurrency (RNF-20): ANTES de "sin cambios".
      if (dto.expectedRevision !== currentRevision) {
        throw new ConflictException({
          code: 'RESOURCE_ALLOCATION_VERSION_CONFLICT',
          message: 'La asignación cambió desde que la abriste. Volvé a cargarla antes de editarla.',
          currentRevision,
        });
      }

      // Estado resultante. Perfil: omitido = conserva; null = quita; UUID distinto del actual = cambia (el MISMO UUID no refresca nada).
      const requestedProfileId = dto.resourceProfileId === undefined ? undefined : dto.resourceProfileId === null ? null : dto.resourceProfileId.toLowerCase();
      const currentProfileId = current?.resourceProfileId ?? null;
      const profileChanged = requestedProfileId !== undefined && requestedProfileId !== currentProfileId;
      // El DTO ya normaliza en el borde HTTP; se repite acá (idempotente) para que la comparación y lo escrito sean la forma canónica.
      const hours = dto.estimatedHours === undefined ? (current?.estimatedHours ?? null) : dto.estimatedHours === null ? null : normalizeHours(dto.estimatedHours.trim());
      const hoursChanged = hours !== (current?.estimatedHours ?? null);
      if (!profileChanged && !hoursChanged) {
        throw new ConflictException({ code: 'RESOURCE_ALLOCATION_NO_CHANGES', message: 'Los datos son idénticos a los de la asignación vigente; no se creó una revisión.' });
      }

      // 5) Snapshot del perfil. Cambia → se lee el catálogo ACTUAL (FOR SHARE: una desactivación concurrente espera o gana).
      //    No cambia → se copia el snapshot vigente SIN consultar el catálogo (la tarifa histórica no se toca).
      let snapshot: { resourceProfileId: string | null; profileName: string | null; hourlyCost: string | null; currency: string | null };
      if (profileChanged && requestedProfileId !== null && requestedProfileId !== undefined) {
        snapshot = await this.snapshotFromCatalog(manager, requestedProfileId, projectCurrency);
      } else if (profileChanged) {
        snapshot = { resourceProfileId: null, profileName: null, hourlyCost: null, currency: null };
      } else {
        snapshot = {
          resourceProfileId: current?.resourceProfileId ?? null,
          profileName: current?.profileName ?? null,
          hourlyCost: current?.hourlyCost ?? null,
          currency: current?.currency ?? null,
        };
      }

      // 6) Presupuesto vigente en este instante (el proyecto está bloqueado FOR SHARE: no puede cambiar a mitad de la operación).
      const budgetId = await this.currentBudgetId(manager, project.id);

      const estimatedCost = hours !== null && snapshot.hourlyCost !== null ? calculateEstimatedCost(hours, snapshot.hourlyCost) : null;

      // 7) y 8) La vigente pasa a histórica (UPDATE antes del INSERT: índice único parcial no diferible) y se inserta la nueva,
      //    con el MISMO instante lógico (clock_timestamp()) para superseded_at y created_at.
      const [clock]: Array<{ now: string; nextRevision: number }> = await manager.query(
        `SELECT clock_timestamp()::text AS now,
                (SELECT COALESCE(MAX(revision), 0) + 1 FROM project_member_allocations WHERE project_member_id = $1)::int AS "nextRevision"`,
        [memberId],
      );
      const { now, nextRevision } = clock!;
      if (current) {
        const superseded = await manager.query(
          `UPDATE project_member_allocations SET is_current = false, superseded_at = $2::timestamptz
            WHERE project_member_id = $1 AND is_current = true RETURNING id`,
          [memberId, now],
        );
        const supersededRows = Array.isArray(superseded[0]) ? (superseded[0] as unknown[]) : superseded;
        if (supersededRows.length !== 1) throw new InternalServerErrorException('No se pudo archivar la asignación vigente.');
      }
      await manager.query(
        `INSERT INTO project_member_allocations
           (project_member_id, revision, is_current, superseded_at, resource_profile_id, profile_name_snapshot, hourly_cost_snapshot, currency_snapshot,
            estimated_hours, estimated_cost_snapshot, budget_id, changed_by, origin, created_at)
         VALUES ($1, $2, true, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)`,
        [
          memberId,
          nextRevision,
          snapshot.resourceProfileId,
          snapshot.profileName,
          snapshot.hourlyCost,
          snapshot.currency,
          hours,
          estimatedCost,
          budgetId,
          user.id,
          AuditOrigin.UI,
          now,
        ],
      );

      const [row]: AllocationRow[] = await manager.query(
        `SELECT ${ALLOCATION_COLUMNS}
           FROM project_members pm
           JOIN users u ON u.id = pm.user_id
           LEFT JOIN project_member_allocations a ON a.project_member_id = pm.id AND a.is_current
           LEFT JOIN budgets b ON b.id = a.budget_id
           LEFT JOIN users cu ON cu.id = a.changed_by
          WHERE pm.id = $1`,
        [memberId],
      );
      return this.toMemberAllocation(row!);
    });
  }

  /** Lee el perfil del catálogo FOR SHARE: debe existir y estar activo. Devuelve el snapshot a congelar. */
  private async snapshotFromCatalog(manager: EntityManager, profileId: string, projectCurrency: string) {
    const profiles: Array<{ id: string; name: string; hourlyCost: string; currency: string; active: boolean }> = await manager.query(
      'SELECT id, name, hourly_cost::text AS "hourlyCost", currency, active FROM resource_profiles WHERE id = $1 FOR SHARE',
      [profileId],
    );
    const profile = profiles[0];
    if (!profile) {
      throw new BadRequestException({ code: 'RESOURCE_PROFILE_NOT_FOUND', message: 'El perfil de recurso no existe.', resourceProfileId: profileId });
    }
    if (!profile.active) {
      throw new BadRequestException({
        code: 'RESOURCE_PROFILE_INACTIVE',
        message: 'El perfil de recurso está inactivo: no se puede asignar a un miembro.',
        resourceProfileId: profile.id,
      });
    }
    // Moneda ÚNICA por proyecto: solo se asignan perfiles de la moneda del proyecto. Nunca se convierte. (Solo aplica a un perfil
    // NUEVO: conservar el actual copia su snapshot sin pasar por acá.)
    if (profile.currency !== projectCurrency) {
      throw new BadRequestException({
        code: 'RESOURCE_PROFILE_CURRENCY_MISMATCH',
        message: `El perfil de recurso utiliza una moneda (${profile.currency}) distinta a la del proyecto (${projectCurrency}).`,
        resourceProfileId: profile.id,
        profileCurrency: profile.currency,
        projectCurrency,
      });
    }
    return { resourceProfileId: profile.id, profileName: profile.name, hourlyCost: profile.hourlyCost, currency: profile.currency };
  }

  /**
   * Presupuesto vigente del proyecto (is_current = true; nunca max(version)). Sin presupuestos → null. Con versiones pero sin
   * vigente, o con la vigente distinta de MAX(version) → 500 (no se guarda un null que ocultaría la inconsistencia).
   */
  private async currentBudgetId(manager: EntityManager, projectId: string): Promise<string | null> {
    const budgets: Array<{ id: string; version: number; maxVersion: number }> = await manager.query(
      `SELECT id, version, (SELECT MAX(version) FROM budgets WHERE project_id = $1)::int AS "maxVersion"
         FROM budgets WHERE project_id = $1 AND is_current = true`,
      [projectId],
    );
    const budget = budgets[0];
    if (budget) {
      if (budget.version !== budget.maxVersion) {
        this.logger.error(`Inconsistencia: el proyecto ${projectId} tiene como vigente la versión ${budget.version} pero la máxima es ${budget.maxVersion}.`);
        throw new InternalServerErrorException({
          code: 'BUDGET_VERSION_STATE_INVALID',
          message: 'La versión vigente del presupuesto no es la de mayor número. Hay que corregirlo.',
        });
      }
      return budget.id;
    }
    const [counted]: Array<{ total: number }> = await manager.query('SELECT COUNT(*)::int AS total FROM budgets WHERE project_id = $1', [projectId]);
    if (counted!.total > 0) {
      this.logger.error(`Inconsistencia: el proyecto ${projectId} tiene ${counted!.total} versión(es) de presupuesto pero NINGUNA vigente; no se crea la revisión.`);
      throw new InternalServerErrorException({
        code: 'BUDGET_NO_CURRENT_VERSION',
        message: 'El proyecto tiene versiones de presupuesto pero ninguna vigente. Hay que corregirlo.',
      });
    }
    return null;
  }

  private toMemberAllocation(row: AllocationRow): MemberResourceAllocation {
    const hasAllocation = row.revision !== null;
    return {
      projectMemberId: row.projectMemberId,
      user: { id: row.userId, name: row.userName },
      allocation: hasAllocation
        ? {
            revision: row.revision!,
            resourceProfile:
              row.resourceProfileId !== null
                ? { id: row.resourceProfileId, name: row.profileName!, hourlyCost: row.hourlyCost!, currency: row.currency! }
                : null,
            estimatedHours: row.estimatedHours,
            estimatedResourceCost: row.estimatedCost !== null ? { amount: row.estimatedCost, currency: row.currency! } : null,
            budgetId: row.budgetId,
            budgetVersion: row.budgetVersion,
            createdAt: this.iso(row.createdAt!),
            changedBy: { id: row.changedById!, name: row.changedByName! },
          }
        : null,
    };
  }

  private iso(value: Date | string): string {
    return new Date(value).toISOString();
  }

  private assertCanView(user: RequestUser, project: ProjectEntity): void {
    // RN-25: sin permiso económico → 403 completo, nunca datos parciales.
    if (!this.permissions.canViewEconomicData(user, project)) {
      throw new ForbiddenException('No tenés permisos para ver la información económica de este proyecto.');
    }
  }

  private memberNotFound(memberId: string): NotFoundException {
    return new NotFoundException({ code: 'PROJECT_MEMBER_NOT_FOUND', message: `Miembro ${memberId} no encontrado en este proyecto.` });
  }

  /** UUID o slug (también un slug anterior del histórico), como los demás endpoints de equipo. */
  private async resolveProject(idOrSlug: string): Promise<ProjectEntity> {
    let project: ProjectEntity | null;
    if (UUID_PATTERN.test(idOrSlug)) {
      project = await this.projectRepo.findOneBy({ id: idOrSlug });
    } else {
      project = await this.projectRepo.findOneBy({ slug: idOrSlug });
      if (!project) {
        const history = await this.slugHistoryRepo.findOneBy({ slug: idOrSlug });
        if (history) project = await this.projectRepo.findOneBy({ id: history.projectId });
      }
    }
    if (!project) throw new NotFoundException(`Project ${idOrSlug} no encontrado`);
    return project;
  }
}
