import { ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ResourceProfileEntity } from '../database/entities/resource-profile.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { AuditEntityType, AuditOrigin } from '../database/enums';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateResourceProfileDto } from './dto/create-resource-profile.dto';
import { UpdateResourceProfileDto } from './dto/update-resource-profile.dto';
import { ListResourceProfilesQueryDto } from './dto/list-resource-profiles-query.dto';
import { ResourceProfileResponseDto, ResourceProfileRow, toResourceProfileResponse } from './dto/resource-profile-response.dto';

export const RESOURCE_PROFILE_CREATED_ACTION = 'RESOURCE_PROFILE_CREATED';
export const RESOURCE_PROFILE_UPDATED_ACTION = 'RESOURCE_PROFILE_UPDATED';
export const RESOURCE_PROFILE_DEACTIVATED_ACTION = 'RESOURCE_PROFILE_DEACTIVATED';
export const RESOURCE_PROFILE_REACTIVATED_ACTION = 'RESOURCE_PROFILE_REACTIVATED';

const POSTGRES_UNIQUE_VIOLATION = '23505';
const NAME_CURRENCY_INDEX = 'ux_resource_profiles_name_currency';

/** Campos editables, en el orden determinístico en que se informan en `changedFields` de la auditoría. */
const EDITABLE_FIELDS = ['name', 'hourlyCost', 'currency', 'active'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];
const EDITABLE_COLUMNS: Record<EditableField, string> = { name: 'name', hourlyCost: 'hourly_cost', currency: 'currency', active: 'active' };

const PROFILE_SELECT = `
  SELECT id, name, hourly_cost::text AS "hourlyCost", currency, active, revision, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM resource_profiles`;

/**
 * Catálogo global de perfiles de recurso con su costo por hora (RF-CT-05, RN-24). Solo catálogo: la asignación a miembros, las
 * horas estimadas y el costo de RRHH son RES-02.
 *
 * PERMISOS (RN-25: el costo/hora es información económica; COLLABORATOR y OBSERVER reciben 403 completo, nunca una lista
 * parcial): ver = ADMIN, PROGRAM_MANAGER, PROJECT_LEADER; administrar = solo ADMIN. Que solo ADMIN administre es una decisión
 * PROVISIONAL de menor privilegio, PENDIENTE de validar con TEMA (ampliar es editar una lista en PermissionsService).
 *
 * UNICIDAD: (lower(name), currency) — el índice de la base es la garantía definitiva; un 23505 se traduce a 409
 * RESOURCE_PROFILE_NAME_CONFLICT (sin depender de un SELECT previo, que tendría una carrera). PENDIENTE de confirmar con TEMA.
 *
 * CONCURRENCIA (RNF-20): `revision` — el PATCH bloquea la fila (FOR UPDATE), compara `expectedRevision` ANTES de "sin cambios" y
 * suma 1 en el mismo UPDATE. `updated_at` es solo metadato (clock_timestamp()). Es un catálogo global: no hay lock de proyecto.
 *
 * TARIFA Y MONEDA MUTABLES — PENDIENTES DE TEMA (no se cierra ninguna alternativa): cuando RES-02 permita asignar perfiles hay
 * que decidir qué pasa con las asignaciones existentes si cambia `hourlyCost` o `currency` (A: usan siempre la tarifa vigente,
 * B: snapshot de tarifa al asignar, C: perfiles versionados, D: otra) y la política de redondeo del costo de RRHH. Hoy no hay
 * asignaciones por API, así que cambiar tarifa o moneda no propaga nada: solo queda auditado. No se convierte ninguna moneda.
 *
 * La auditoría va a `audit_logs` (RN-25: lleva tarifas), nunca a `project_activities` (es un catálogo global, no actividad de un proyecto).
 */
@Injectable()
export class ResourceProfilesService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly dataSource: DataSource,
  ) {}

  /** Perfiles activos (por defecto) o todos (`includeInactive`), en orden determinístico. */
  async list(query: ListResourceProfilesQueryDto, user: RequestUser): Promise<ResourceProfileResponseDto[]> {
    if (!this.permissions.canViewResourceProfiles(user)) {
      throw new ForbiddenException('No tenés permisos para ver los perfiles de recurso.');
    }
    const rows: ResourceProfileRow[] = await this.dataSource.manager.query(
      `${PROFILE_SELECT}
        WHERE ($1::boolean OR active)
        ORDER BY lower(name) ASC, name ASC, currency ASC, id ASC`,
      [query.includeInactive === true],
    );
    return rows.map(toResourceProfileResponse);
  }

  async create(dto: CreateResourceProfileDto, user: RequestUser): Promise<ResourceProfileResponseDto> {
    this.assertCanManage(user);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const saved = await manager.save(
          manager.create(ResourceProfileEntity, {
            name: dto.name,
            hourlyCost: dto.hourlyCost,
            currency: dto.currency,
            active: true,
            revision: 1,
          }),
        );
        await manager.save(
          manager.create(AuditLogEntity, {
            entityType: AuditEntityType.RESOURCE_PROFILE,
            entityId: saved.id,
            action: RESOURCE_PROFILE_CREATED_ACTION,
            userId: user.id,
            origin: AuditOrigin.UI,
            oldValues: null,
            newValues: this.snapshot({ name: dto.name, hourlyCost: dto.hourlyCost, currency: dto.currency, active: true }, 1),
          }),
        );
        const [row]: ResourceProfileRow[] = await manager.query(`${PROFILE_SELECT} WHERE id = $1`, [saved.id]);
        return toResourceProfileResponse(row!);
      });
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }
  }

  /**
   * Edición parcial. 403 → [transacción] perfil FOR UPDATE (404) → `expectedRevision` (409) → "sin cambios" (409) → UPDATE con
   * revision + 1 → auditoría. Todo o nada.
   */
  async update(profileId: string, dto: UpdateResourceProfileDto, user: RequestUser): Promise<ResourceProfileResponseDto> {
    this.assertCanManage(user);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const currents: CurrentProfile[] = await manager.query(
          `SELECT id, name, hourly_cost::text AS "hourlyCost", currency, active, revision FROM resource_profiles WHERE id = $1 FOR UPDATE`,
          [profileId],
        );
        const current = currents[0];
        if (!current) {
          throw new NotFoundException({ code: 'RESOURCE_PROFILE_NOT_FOUND', message: 'El perfil de recurso no existe.' });
        }

        // Optimistic concurrency (RNF-20): ANTES de "sin cambios".
        if (dto.expectedRevision !== current.revision) {
          throw new ConflictException({
            code: 'RESOURCE_PROFILE_VERSION_CONFLICT',
            message: 'El perfil cambió desde que lo abriste. Volvé a cargarlo antes de editarlo.',
            currentRevision: current.revision,
          });
        }

        // El DTO ya normaliza en el borde HTTP; se repite acá (idempotente) para que la comparación y lo escrito sean la forma canónica.
        const next = {
          name: dto.name !== undefined ? dto.name.trim() : current.name,
          hourlyCost: dto.hourlyCost !== undefined ? dto.hourlyCost.trim() : current.hourlyCost,
          currency: dto.currency !== undefined ? dto.currency.trim().toUpperCase() : current.currency,
          active: dto.active !== undefined ? dto.active : current.active,
        };
        next.hourlyCost = normalizeForCompare(next.hourlyCost);
        const changedFields = EDITABLE_FIELDS.filter((field) => next[field] !== current[field]);
        if (changedFields.length === 0) {
          throw new ConflictException({ code: 'RESOURCE_PROFILE_NO_CHANGES', message: 'Los datos son idénticos a los del perfil actual; no se modificó nada.' });
        }

        const assignments: string[] = [];
        const values: unknown[] = [];
        for (const field of changedFields) {
          values.push(next[field]);
          assignments.push(`${EDITABLE_COLUMNS[field]} = $${values.length}`);
        }
        values.push(profileId);
        const updated: unknown = await manager.query(
          `UPDATE resource_profiles SET ${assignments.join(', ')}, updated_at = clock_timestamp(), revision = revision + 1
            WHERE id = $${values.length} RETURNING revision`,
          values,
        );
        // En el formato de TypeORM para UPDATE ... RETURNING el resultado es [filas, cantidad].
        const rows = (Array.isArray((updated as unknown[])[0]) ? (updated as unknown[][])[0] : (updated as unknown[])) as Array<{ revision: number }>;
        const newRevision = rows[0]?.revision;
        if (newRevision !== current.revision + 1) {
          throw new InternalServerErrorException('No se pudo actualizar el perfil de recurso.');
        }

        await manager.save(
          manager.create(AuditLogEntity, {
            entityType: AuditEntityType.RESOURCE_PROFILE,
            entityId: profileId,
            action: this.actionFor(changedFields, next.active),
            userId: user.id,
            origin: AuditOrigin.UI,
            oldValues: this.snapshot(current, current.revision),
            newValues: { ...this.snapshot(next, newRevision), change: { changedFields } },
          }),
        );

        const [row]: ResourceProfileRow[] = await manager.query(`${PROFILE_SELECT} WHERE id = $1`, [profileId]);
        return toResourceProfileResponse(row!);
      });
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }
  }

  /**
   * Si el ÚNICO campo que cambia es `active`, la acción es DEACTIVATED / REACTIVATED; si cambia junto con otro campo es UPDATED,
   * para no ocultar el resto de los cambios bajo una acción de estado.
   */
  private actionFor(changedFields: readonly EditableField[], nextActive: boolean): string {
    if (changedFields.length === 1 && changedFields[0] === 'active') {
      return nextActive ? RESOURCE_PROFILE_REACTIVATED_ACTION : RESOURCE_PROFILE_DEACTIVATED_ACTION;
    }
    return RESOURCE_PROFILE_UPDATED_ACTION;
  }

  /** Snapshot para audit_logs: la tarifa siempre como texto; lleva tarifas, por eso solo se lee con permiso económico (RN-25). */
  private snapshot(profile: { name: string; hourlyCost: string; currency: string; active: boolean }, revision: number) {
    return { name: profile.name, hourlyCost: profile.hourlyCost, currency: profile.currency, active: profile.active, revision };
  }

  private assertCanManage(user: RequestUser): void {
    if (!this.permissions.canManageResourceProfiles(user)) {
      throw new ForbiddenException('No tenés permisos para administrar los perfiles de recurso.');
    }
  }

  /** La unicidad la garantiza el índice (no un SELECT previo, que tendría una carrera): su violación es el 409. */
  private translateUniqueViolation(error: unknown): unknown {
    const driverError = (error as { driverError?: { code?: string; constraint?: string } }).driverError;
    if (driverError?.code === POSTGRES_UNIQUE_VIOLATION && (driverError.constraint === undefined || driverError.constraint === NAME_CURRENCY_INDEX)) {
      return new ConflictException({
        code: 'RESOURCE_PROFILE_NAME_CONFLICT',
        message: 'Ya existe un perfil con ese nombre en esa moneda.',
      });
    }
    return error;
  }
}

interface CurrentProfile {
  id: string;
  name: string;
  hourlyCost: string;
  currency: string;
  active: boolean;
  revision: number;
}

/** "50" → "50.00" para comparar (la columna siempre vuelve con 2 decimales). */
function normalizeForCompare(hourlyCost: string): string {
  const [integer = '0', decimals = ''] = hourlyCost.split('.');
  return /^\d+(\.\d{1,2})?$/.test(hourlyCost) ? `${integer.replace(/^0+(?=\d)/, '')}.${decimals.padEnd(2, '0')}` : hourlyCost;
}
