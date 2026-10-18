import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BudgetEntity } from '../database/entities/budget.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { ProjectEntity } from '../projects/project.entity';
import { AuditEntityType, AuditOrigin } from '../database/enums';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { CreateBudgetVersionDto } from './dto/create-budget-version.dto';
import { BudgetResponseDto, toBudgetResponse } from './dto/budget-response.dto';

/** `audit_logs.action` es texto libre; misma convención <ENTIDAD>_<VERBO> que TASK_CREATED, PROJECT_CREATED... */
export const BUDGET_CREATED_ACTION = 'BUDGET_CREATED';
export const BUDGET_VERSION_CREATED_ACTION = 'BUDGET_VERSION_CREATED';

const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Presupuesto de un proyecto (RF-CT-01 / RN-18): presupuesto inicial (versión 1), nuevas versiones y lectura del vigente.
 * El historial (GET de versiones), partidas y costos son tareas aparte.
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
 *  - PRES-04/costos: cómo interactúa un CAMBIO DE MONEDA entre versiones con partidas y costos ya cargados (hoy: se permite
 *    sin restricciones, no hay partidas ni costos todavía).
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

        await manager.save(
          manager.create(AuditLogEntity, {
            entityType: AuditEntityType.BUDGET,
            entityId: saved.id,
            action: BUDGET_CREATED_ACTION,
            userId: user.id,
            origin: AuditOrigin.UI,
            oldValues: null,
            newValues: {
              projectId,
              version: saved.version,
              totalAmount: saved.totalAmount,
              currency: saved.currency,
              approvalDate: saved.approvalDate,
            },
          }),
        );

        return toBudgetResponse(saved);
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

      if (
        current.totalAmount === dto.totalAmount &&
        current.currency === dto.currency &&
        current.approvalDate === dto.approvalDate
      ) {
        throw new ConflictException({
          code: 'BUDGET_NO_CHANGES',
          message: 'Los datos son idénticos a los del presupuesto vigente; no se creó una versión nueva.',
        });
      }

      // Única modificación permitida sobre la versión anterior: is_current y superseded_at.
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

      await manager.save(
        manager.create(AuditLogEntity, {
          entityType: AuditEntityType.BUDGET,
          entityId: saved.id,
          action: BUDGET_VERSION_CREATED_ACTION,
          userId: user.id,
          origin: AuditOrigin.UI,
          oldValues: this.auditSnapshot(current),
          newValues: this.auditSnapshot(saved),
        }),
      );

      return toBudgetResponse(saved);
    });
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
      return toBudgetResponse(current);
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

  /** Importes siempre como string; sin supersededAt/createdAt (se leen de la fila). */
  private auditSnapshot(budget: BudgetEntity) {
    return {
      budgetId: budget.id,
      projectId: budget.projectId,
      version: budget.version,
      totalAmount: budget.totalAmount,
      currency: budget.currency,
      approvalDate: budget.approvalDate,
    };
  }

  private alreadyExists(): ConflictException {
    return new ConflictException({
      code: 'BUDGET_ALREADY_EXISTS',
      message: 'El proyecto ya tiene un presupuesto. Para modificarlo hay que crear una nueva versión.',
    });
  }
}
