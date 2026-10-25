import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import dataSource from '../database/data-source';
import { BudgetsService } from './budgets.service';
import { PermissionsService } from '../auth/permissions.service';
import { BudgetEntity } from '../database/entities/budget.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { BudgetItemEntity } from '../database/entities/budget-item.entity';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { CreateBudgetVersionDto } from './dto/create-budget-version.dto';

/**
 * BudgetsService contra PostgreSQL REAL: concurrencia, atomicidad con audit_logs y regla is_current.
 *   pnpm --filter @tema/backend test:db
 * A diferencia de budgets.constraints.db-spec.ts, acá el servicio abre SUS PROPIAS transacciones (se confirman), así que
 * los datos de prueba se crean y se BORRAN explícitamente (suffix único: no toca datos reales).
 */
const SUFFIX = `pres02-${Date.now()}`;

/** Rubros reales del catálogo (los cinco iniciales los garantiza la migración). Se cargan en beforeAll. */
const cats = { rrhh: '', lic: '' };
/** Rubros TEMPORALES de este test (para desactivar/probar inactivos sin tocar el catálogo real). */
const tempCategoryIds: string[] = [];
let tempActive = '';
let tempInactive = '';

/** Presupuesto de un solo rubro (RRHH) por el total indicado: la suma coincide exactamente con el total. */
let dto: CreateBudgetDto;
const withTotal = (total: string, extra: Partial<CreateBudgetVersionDto> = {}): CreateBudgetVersionDto => ({
  expectedVersion: 1,
  totalAmount: total,
  currency: 'ARS',
  approvalDate: '2026-10-12',
  items: [{ costCategoryId: cats.rrhh, amount: total }],
  ...extra,
});


let adminActor: RequestUser;
let secondAdminActor: RequestUser;
let collaboratorActor: RequestUser;
const userIds: string[] = [];
let projectId: string;
let service: BudgetsService;
const projectIds: string[] = [];

function buildService(ds: DataSource | object = dataSource): BudgetsService {
  return new BudgetsService(
    dataSource.getRepository(BudgetEntity),
    dataSource.getRepository(ProjectEntity),
    new PermissionsService(dataSource.getRepository(ProjectMemberEntity)),
    ds as DataSource,
  );
}

async function createUser(label: string, roles: RoleName[]): Promise<RequestUser> {
  const [{ id }] = await dataSource.query(`INSERT INTO users (email, name, active) VALUES ($1, $2, true) RETURNING id`, [`${label}-${SUFFIX}@tema-test.com`, label]);
  userIds.push(id);
  return { id, roles } as RequestUser;
}

async function createProject(leaderId: string): Promise<string> {
  const n = `${SUFFIX}-${projectIds.length}`;
  const [{ id }] = await dataSource.query(
    `INSERT INTO projects (name, slug, status, leader_id, created_by) VALUES ($1, $2, 'PLANNED', $3, $3) RETURNING id`,
    [`Test ${n}`, `test-${n}`, leaderId],
  );
  projectIds.push(id);
  return id as string;
}

const count = async (sql: string, params: unknown[]): Promise<number> => (await dataSource.query(sql, params))[0].n as number;
const budgetsOf = (id: string) => count(`SELECT count(*)::int AS n FROM budgets WHERE project_id = $1`, [id]);
const auditsOf = (id: string) =>
  count(`SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'BUDGET' AND entity_id IN (SELECT id FROM budgets WHERE project_id = $1)`, [id]);

beforeAll(async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  adminActor = await createUser('admin', [RoleName.ADMIN]);
  secondAdminActor = await createUser('admin2', [RoleName.PROGRAM_MANAGER]);
  collaboratorActor = await createUser('collab', [RoleName.COLLABORATOR]);
  service = buildService();

  const rows: Array<{ id: string; name: string }> = await dataSource.query(`SELECT id, name FROM cost_categories WHERE active`);
  const idOf = (name: string) => rows.find((r) => r.name === name)!.id;
  cats.rrhh = idOf('Recursos humanos');
  cats.lic = idOf('Licencias y software');
  const [active, inactive] = await dataSource.query(
    `INSERT INTO cost_categories (name, active) VALUES ($1, true), ($2, false) RETURNING id`,
    [`zz-test-activo-${SUFFIX}`, `zz-test-inactivo-${SUFFIX}`],
  );
  tempActive = active.id;
  tempInactive = inactive.id;
  tempCategoryIds.push(active.id, inactive.id);

  dto = {
    totalAmount: '1500000.50',
    currency: 'ARS',
    approvalDate: '2026-10-12',
    items: [
      { costCategoryId: cats.rrhh, amount: '1000000.50' },
      { costCategoryId: cats.lic, amount: '500000.00' },
    ],
  };
});

beforeEach(async () => {
  projectId = await createProject(adminActor.id);
});

afterAll(async () => {
  // audit_logs.entity_id no tiene FK: se borra por los ids de presupuesto ANTES de que el proyecto arrastre los budgets
  await dataSource.query(`DELETE FROM audit_logs WHERE entity_type = 'BUDGET' AND entity_id IN (SELECT id FROM budgets WHERE project_id = ANY($1::uuid[]))`, [projectIds]);
  await dataSource.query(`DELETE FROM projects WHERE id = ANY($1::uuid[])`, [projectIds]);
  await dataSource.query(`DELETE FROM cost_categories WHERE id = ANY($1::uuid[])`, [tempCategoryIds]);
  await dataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  if (dataSource.isInitialized) await dataSource.destroy();
});

describe('POST: presupuesto inicial', () => {
  it('crea la versión 1 vigente, con el importe exacto', async () => {
    const created = await service.create(projectId, withTotal('123456789012.34'), adminActor);

    const [row] = await dataSource.query(
      `SELECT version, is_current, superseded_at, total_amount::text AS total, currency, approval_date::text AS approval_date, created_by FROM budgets WHERE id = $1`,
      [created.id],
    );
    expect(row).toEqual({ version: 1, is_current: true, superseded_at: null, total: '123456789012.34', currency: 'ARS', approval_date: '2026-10-12', created_by: adminActor.id });
    expect(created).toMatchObject({ version: 1, isCurrent: true, supersededAt: null, totalAmount: '123456789012.34', approvalDate: '2026-10-12' });
  });

  it('el importe sin decimales queda con 2 decimales exactos en la base', async () => {
    const created = await service.create(projectId, withTotal('1000.00'), adminActor);
    expect(created.totalAmount).toBe('1000.00');
  });

  it('escribe la auditoría en audit_logs con los datos esperados', async () => {
    const created = await service.create(projectId, dto, adminActor);
    const [audit] = await dataSource.query(
      `SELECT entity_type, entity_id, action, user_id, origin, old_values, new_values FROM audit_logs WHERE entity_id = $1`,
      [created.id],
    );
    expect(audit).toEqual({
      entity_type: 'BUDGET',
      entity_id: created.id,
      action: 'BUDGET_CREATED',
      user_id: adminActor.id,
      origin: 'UI',
      old_values: null,
      new_values: {
        budgetId: created.id,
        projectId,
        version: 1,
        totalAmount: '1500000.50',
        currency: 'ARS',
        approvalDate: '2026-10-12',
        items: [
          { costCategoryId: cats.lic, categoryName: 'Licencias y software', amount: '500000.00' },
          { costCategoryId: cats.rrhh, categoryName: 'Recursos humanos', amount: '1000000.50' },
        ],
      },
    });
  });

  it('presupuesto y auditoría se escriben en LA MISMA transacción (mismo xmin)', async () => {
    const created = await service.create(projectId, dto, adminActor);
    const [{ same }] = await dataSource.query(
      `SELECT (SELECT xmin::text FROM budgets WHERE id = $1) = (SELECT xmin::text FROM audit_logs WHERE entity_id = $1) AS same`,
      [created.id],
    );
    expect(same).toBe(true);
  });

  it('NO escribe nada en project_activities (RN-25: ese feed lo ven todos los miembros)', async () => {
    await service.create(projectId, dto, adminActor);
    expect(await count(`SELECT count(*)::int AS n FROM project_activities WHERE project_id = $1`, [projectId])).toBe(0);
  });

  it('PROGRAM_MANAGER también puede', async () => {
    await expect(service.create(projectId, dto, secondAdminActor)).resolves.toMatchObject({ version: 1, createdBy: secondAdminActor.id });
  });

  it('un segundo POST es 409 BUDGET_ALREADY_EXISTS y no deja nada nuevo', async () => {
    await service.create(projectId, dto, adminActor);
    const error = await service.create(projectId, withTotal('5.00'), adminActor).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'BUDGET_ALREADY_EXISTS' });
    expect(await budgetsOf(projectId)).toBe(1);
    expect(await auditsOf(projectId)).toBe(1);
  });

  it('sin permiso (COLLABORATOR): 403 y la base queda intacta', async () => {
    await expect(service.create(projectId, dto, collaboratorActor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await budgetsOf(projectId)).toBe(0);
    expect(await auditsOf(projectId)).toBe(0);
  });
});

describe('concurrencia: dos (o más) altas simultáneas del mismo proyecto', () => {
  it.each([2, 5])('%s POST en paralelo → exactamente UN 201 y el resto 409; una sola fila de presupuesto y de auditoría', async (parallel) => {
    const actors = [adminActor, secondAdminActor];
    const results = await Promise.allSettled(
      Array.from({ length: parallel }, (_, i) => service.create(projectId, withTotal(`${i + 1}00.00`), actors[i % 2]!)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(parallel - 1);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(ConflictException);
      expect((r.reason as ConflictException).getResponse()).toMatchObject({ code: 'BUDGET_ALREADY_EXISTS' });
    }
    expect(await budgetsOf(projectId)).toBe(1);
    expect(await auditsOf(projectId)).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM budgets WHERE project_id = $1 AND is_current`, [projectId])).toBe(1);
  });

  it('altas simultáneas de proyectos DISTINTOS no se bloquean entre sí', async () => {
    const otherProject = await createProject(adminActor.id);
    const results = await Promise.all([service.create(projectId, dto, adminActor), service.create(otherProject, dto, secondAdminActor)]);
    expect(results.map((r) => r.version)).toEqual([1, 1]);
  });
});

describe('atomicidad con audit_logs', () => {
  it('si falla la auditoría, el presupuesto (ya insertado dentro de la transacción) se revierte: no queda nada', async () => {
    let budgetInsertedBeforeFailure = false;
    const failingDataSource = {
      transaction: (run: (manager: unknown) => Promise<unknown>) =>
        dataSource.transaction(async (manager) =>
          run(
            new Proxy(manager, {
              get(target, prop, receiver) {
                if (prop !== 'save') return Reflect.get(target, prop, receiver);
                return async (row: object) => {
                  if (row instanceof AuditLogEntity) throw new Error('fallo simulado al insertar en audit_logs');
                  const result = await target.save(row);
                  if (row instanceof BudgetEntity) budgetInsertedBeforeFailure = true;
                  return result;
                };
              },
            }),
          ),
        ),
    };
    const failingService = buildService(failingDataSource);

    await expect(failingService.create(projectId, dto, adminActor)).rejects.toThrow('fallo simulado');

    expect(budgetInsertedBeforeFailure).toBe(true); // el INSERT del presupuesto SÍ había ocurrido...
    expect(await budgetsOf(projectId)).toBe(0); // ...y aun así no quedó ni el presupuesto
    expect(await count(`SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'BUDGET' AND new_values->>'projectId' = $1`, [projectId])).toBe(0);
  });

  it('tras ese fallo el alta puede reintentarse normalmente (el lock se liberó)', async () => {
    await expect(service.create(projectId, dto, adminActor)).resolves.toMatchObject({ version: 1 });
  });
});

describe('GET: presupuesto vigente (solo is_current = true)', () => {
  it('devuelve el vigente', async () => {
    const created = await service.create(projectId, dto, adminActor);
    await expect(service.getCurrent(projectId, adminActor)).resolves.toMatchObject({ id: created.id, version: 1, isCurrent: true });
  });

  it('COLLABORATOR no recibe nada: 403', async () => {
    await service.create(projectId, dto, adminActor);
    await expect(service.getCurrent(projectId, collaboratorActor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('con una versión histórica de número MAYOR que la vigente, devuelve la vigente (no max(version))', async () => {
    await dataSource.query(
      `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, created_by) VALUES ($1, 1, 100.00, 'ARS', '2026-01-01', true, $2)`,
      [projectId, adminActor.id],
    );
    await dataSource.query(
      `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, superseded_at, created_by) VALUES ($1, 2, 999.00, 'ARS', '2026-02-01', false, now(), $2)`,
      [projectId, adminActor.id],
    );

    const current = await service.getCurrent(projectId, adminActor);
    expect(current).toMatchObject({ version: 1, totalAmount: '100.00', isCurrent: true });
  });

  it('versiones históricas pero NINGUNA vigente: inconsistencia reportada (500 con código), sin elegir ninguna', async () => {
    await dataSource.query(
      `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, superseded_at, created_by) VALUES ($1, 1, 100.00, 'ARS', '2026-01-01', false, now(), $2)`,
      [projectId, adminActor.id],
    );
    const error = await service.getCurrent(projectId, adminActor).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect((error as InternalServerErrorException).getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
  });

  it('sin presupuesto: 404 BUDGET_NOT_FOUND', async () => {
    await expect(service.getCurrent(projectId, adminActor)).rejects.toMatchObject({ response: { code: 'BUDGET_NOT_FOUND' } });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// PRES-03: nuevas versiones
// ---------------------------------------------------------------------------------------------------------------------
describe('createVersion: nuevas versiones del presupuesto', () => {
  // Request que SÍ cambia respecto de V1 (1.000.000 en un solo rubro): 1.200.000 = RRHH 800.000 + Licencias 400.000
  const next: CreateBudgetVersionDto = {
    expectedVersion: 1,
    totalAmount: '1200000.00',
    currency: 'ARS',
    approvalDate: '2026-11-01',
    items: [
      { costCategoryId: '', amount: '800000.00' },
      { costCategoryId: '', amount: '400000.00' },
    ],
  };
  beforeAll(() => {
    next.items[0]!.costCategoryId = cats.rrhh;
    next.items[1]!.costCategoryId = cats.lic;
  });
  /** Versión de un solo rubro por el total indicado (suma exacta). */
  const versionWith = (total: string, extra: Partial<CreateBudgetVersionDto> = {}) => withTotal(total, { expectedVersion: 1, approvalDate: '2026-11-01', ...extra });
  const rowsOf = (id: string) =>
    dataSource.query(
      `SELECT id, version, is_current, superseded_at, total_amount::text AS total, currency, approval_date::text AS approval_date, created_by, created_at FROM budgets WHERE project_id = $1 ORDER BY version`,
      [id],
    );
  const currentMatchesMax = async (id: string) => {
    const [{ ok }] = await dataSource.query(
      `SELECT (SELECT version FROM budgets WHERE project_id = $1 AND is_current) = (SELECT MAX(version) FROM budgets WHERE project_id = $1) AS ok`,
      [id],
    );
    return ok as boolean;
  };
  const failingVersionService = (shouldFail: (row: object) => boolean) =>
    buildService({
      transaction: (run: (manager: unknown) => Promise<unknown>) =>
        dataSource.transaction(async (manager) =>
          run(
            new Proxy(manager, {
              get(target, prop, receiver) {
                if (prop !== 'save') return Reflect.get(target, prop, receiver);
                return async (row: object) => {
                  if (shouldFail(row)) throw new Error('fallo simulado');
                  return target.save(row);
                };
              },
            }),
          ),
        ),
    });

  beforeEach(async () => {
    await service.create(projectId, withTotal('1000000.00'), adminActor);
  });

  it('V1 queda histórica, V2 vigente, supersededAt = createdAt de V2 y V1 intacta salvo is_current/superseded_at', async () => {
    const before = (await rowsOf(projectId))[0];
    const created = await service.createVersion(projectId, { ...next, currency: 'ARS' }, adminActor);
    const [v1, v2] = await rowsOf(projectId);

    expect(created).toMatchObject({ version: 2, isCurrent: true, supersededAt: null, currency: 'ARS', totalAmount: '1200000.00' });
    expect(v1).toEqual({ ...before, is_current: false, superseded_at: expect.any(Date) });
    expect(v1.superseded_at.getTime()).toBe(v2.created_at.getTime());
    expect(v2).toMatchObject({ version: 2, is_current: true, superseded_at: null, created_by: adminActor.id });
    expect(await count(`SELECT count(*)::int AS n FROM budgets WHERE project_id = $1 AND is_current`, [projectId])).toBe(1);
  });

  it('secuencia V1 → V2 → V3; la vigente siempre coincide con MAX(version)', async () => {
    expect(await currentMatchesMax(projectId)).toBe(true);
    await service.createVersion(projectId, next, adminActor);
    expect(await currentMatchesMax(projectId)).toBe(true);
    await service.createVersion(projectId, versionWith('900000.00', { expectedVersion: 2 }), secondAdminActor);
    expect(await currentMatchesMax(projectId)).toBe(true);

    const rows = await rowsOf(projectId);
    expect(rows.map((r: { version: number; is_current: boolean }) => [r.version, r.is_current])).toEqual([[1, false], [2, false], [3, true]]);
    expect(rows.map((r: { total: string }) => r.total)).toEqual(['1000000.00', '1200000.00', '900000.00']);
    await expect(service.getCurrent(projectId, adminActor)).resolves.toMatchObject({ version: 3, totalAmount: '900000.00' });
  });

  it('MONEDA ÚNICA: el cambio de moneda entre versiones NO está permitido (400 PROJECT_CURRENCY_MISMATCH) y no deja una versión nueva', async () => {
    await expect(service.createVersion(projectId, withTotal('1000000.00', { currency: 'USD' }), adminActor)).rejects.toMatchObject({
      response: { code: 'PROJECT_CURRENCY_MISMATCH', projectCurrency: 'ARS' },
    });
    expect((await rowsOf(projectId)).map((r: { version: number; is_current: boolean }) => [r.version, r.is_current])).toEqual([[1, true]]);
  });

  it('precisión decimal intacta en V1 y V2', async () => {
    await service.createVersion(projectId, versionWith('123456789012.34'), adminActor);
    await service.createVersion(projectId, versionWith('0.10', { expectedVersion: 2 }), adminActor);
    expect((await rowsOf(projectId)).map((r: { total: string }) => r.total)).toEqual(['1000000.00', '123456789012.34', '0.10']);
  });

  it('auditoría: BUDGET_VERSION_CREATED con anterior/nueva, misma transacción, nada en project_activities', async () => {
    const [v1Row] = await rowsOf(projectId);
    const created = await service.createVersion(projectId, next, adminActor);
    const [audit] = await dataSource.query(
      `SELECT entity_type, entity_id, action, user_id, origin, old_values, new_values FROM audit_logs WHERE entity_id = $1`,
      [created.id],
    );
    expect(audit).toEqual({
      entity_type: 'BUDGET',
      entity_id: created.id,
      action: 'BUDGET_VERSION_CREATED',
      user_id: adminActor.id,
      origin: 'UI',
      old_values: {
        budgetId: v1Row.id, projectId, version: 1, totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-12',
        items: [{ costCategoryId: cats.rrhh, categoryName: 'Recursos humanos', amount: '1000000.00' }],
      },
      new_values: {
        budgetId: created.id, projectId, version: 2, totalAmount: '1200000.00', currency: 'ARS', approvalDate: '2026-11-01',
        items: [
          { costCategoryId: cats.lic, categoryName: 'Licencias y software', amount: '400000.00' },
          { costCategoryId: cats.rrhh, categoryName: 'Recursos humanos', amount: '800000.00' },
        ],
      },
    });
    const [{ same }] = await dataSource.query(
      `SELECT (SELECT xmin::text FROM budgets WHERE id = $1) = (SELECT xmin::text FROM audit_logs WHERE entity_id = $1) AS same`,
      [created.id],
    );
    expect(same).toBe(true);
    expect(await count(`SELECT count(*)::int AS n FROM project_activities WHERE project_id = $1`, [projectId])).toBe(0);
  });

  describe('errores sin efectos', () => {
    const snapshot = async () => JSON.stringify([await rowsOf(projectId), await auditsOf(projectId)]);

    it('COLLABORATOR: 403', async () => {
      const before = await snapshot();
      await expect(service.createVersion(projectId, next, collaboratorActor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await snapshot()).toBe(before);
    });

    it('expectedVersion desactualizado: 409 BUDGET_VERSION_CONFLICT con currentVersion', async () => {
      await service.createVersion(projectId, next, adminActor); // V2
      const before = await snapshot();
      const error = await service.createVersion(projectId, versionWith('5.00'), secondAdminActor).catch((e: unknown) => e); // sigue creyendo que es V1
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'BUDGET_VERSION_CONFLICT', currentVersion: 2 });
      expect(await snapshot()).toBe(before);
    });

    it('sin cambios: 409 BUDGET_NO_CHANGES', async () => {
      const before = await snapshot();
      const error = await service
        .createVersion(projectId, withTotal('1000000.00'), adminActor)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'BUDGET_NO_CHANGES' });
      expect(await snapshot()).toBe(before);
    });

    it('proyecto sin presupuesto: 404 BUDGET_NOT_FOUND', async () => {
      const empty = await createProject(adminActor.id);
      await expect(service.createVersion(empty, next, adminActor)).rejects.toMatchObject({ response: { code: 'BUDGET_NOT_FOUND' } });
    });

    it('proyecto inexistente: 404', async () => {
      await expect(service.createVersion('00000000-0000-4000-8000-000000000000', next, adminActor)).rejects.toMatchObject({ status: 404 });
    });

    it('versiones pero ninguna vigente: 500 BUDGET_NO_CURRENT_VERSION y nada cambia', async () => {
      await dataSource.query(`UPDATE budgets SET is_current = false, superseded_at = now() WHERE project_id = $1`, [projectId]);
      const before = await snapshot();
      const error = await service.createVersion(projectId, next, adminActor).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
      expect(await snapshot()).toBe(before);
    });

    it('vigente ≠ MAX(version): 500 BUDGET_VERSION_STATE_INVALID y nada cambia', async () => {
      await dataSource.query(
        `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, superseded_at, created_by) VALUES ($1, 3, 1.00, 'ARS', '2026-01-01', false, now(), $2)`,
        [projectId, adminActor.id],
      );
      const before = await snapshot();
      const error = await service.createVersion(projectId, next, adminActor).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getResponse()).toMatchObject({ code: 'BUDGET_VERSION_STATE_INVALID' });
      expect(await snapshot()).toBe(before);
    });

    it('con huecos coherentes (V1, V2 históricas y V4 vigente) la siguiente es V5', async () => {
      await dataSource.query(`DELETE FROM audit_logs WHERE entity_id IN (SELECT id FROM budgets WHERE project_id = $1)`, [projectId]);
      await dataSource.query(`DELETE FROM budgets WHERE project_id = $1`, [projectId]);
      for (const [version, current] of [[1, false], [2, false], [4, true]] as const) {
        await dataSource.query(
          `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, superseded_at, created_by) VALUES ($1, $2, 10.00, 'ARS', '2026-01-01', $3, ${current ? 'NULL' : 'now()'}, $4)`,
          [projectId, version, current, adminActor.id],
        );
      }
      await expect(service.createVersion(projectId, { ...next, expectedVersion: 4 }, adminActor)).resolves.toMatchObject({ version: 5 });
    });
  });

  describe('rollback / atomicidad', () => {
    it.each([
      ['la auditoría (V1 ya desactivada y V2 ya insertada)', (row: object) => row instanceof AuditLogEntity],
      ['el INSERT de V2 (V1 ya desactivada)', (row: object) => row instanceof BudgetEntity],
    ])('si falla %s no queda nada: V1 vigente e intacta, sin V2 ni auditoría', async (_label, shouldFail) => {
      const before = JSON.stringify(await rowsOf(projectId));
      await expect(failingVersionService(shouldFail).createVersion(projectId, next, adminActor)).rejects.toThrow('fallo simulado');

      expect(JSON.stringify(await rowsOf(projectId))).toBe(before);
      expect(await count(`SELECT count(*)::int AS n FROM budgets WHERE project_id = $1 AND is_current`, [projectId])).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'BUDGET_VERSION_CREATED' AND new_values->>'projectId' = $1`, [projectId])).toBe(0);
      await expect(service.createVersion(projectId, next, adminActor)).resolves.toMatchObject({ version: 2 }); // el lock se liberó
    });
  });

  describe('concurrencia', () => {
    it.each([2, 5])('%s modificaciones simultáneas con expectedVersion = 1 → un 201 (V2) y el resto 409 BUDGET_VERSION_CONFLICT', async (parallel) => {
      const actors = [adminActor, secondAdminActor];
      const results = await Promise.allSettled(
        Array.from({ length: parallel }, (_, i) => service.createVersion(projectId, versionWith(`${i + 1}00.00`), actors[i % 2]!)),
      );
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rejected).toHaveLength(parallel - 1);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(ConflictException);
        expect((r.reason as ConflictException).getResponse()).toMatchObject({ code: 'BUDGET_VERSION_CONFLICT', currentVersion: 2 });
      }
      expect((await rowsOf(projectId)).map((r: { version: number }) => r.version)).toEqual([1, 2]);
      expect(await count(`SELECT count(*)::int AS n FROM budgets WHERE project_id = $1 AND is_current`, [projectId])).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'BUDGET_VERSION_CREATED' AND new_values->>'projectId' = $1`, [projectId])).toBe(1);
      expect(await currentMatchesMax(projectId)).toBe(true);
    });

    it('un lector concurrente nunca ve cero ni dos vigentes mientras se versiona', async () => {
      let running = true;
      const observed = new Set<number>();
      const reader = (async () => {
        while (running) {
          const [{ n }] = await dataSource.query(`SELECT count(*) FILTER (WHERE is_current)::int AS n FROM budgets WHERE project_id = $1`, [projectId]);
          observed.add(n as number);
        }
      })();
      for (let version = 1; version <= 12; version++) {
        await service.createVersion(projectId, versionWith(`${version + 1}.00`, { expectedVersion: version }), adminActor);
      }
      running = false;
      await reader;
      expect([...observed]).toEqual([1]);
      expect(await currentMatchesMax(projectId)).toBe(true);
    });

    it('versionados de proyectos distintos no se bloquean entre sí', async () => {
      const other = await createProject(adminActor.id);
      await service.create(other, dto, adminActor);
      const results = await Promise.all([service.createVersion(projectId, next, adminActor), service.createVersion(other, versionWith('7.00'), secondAdminActor)]);
      expect(results.map((r) => r.version)).toEqual([2, 2]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// PRES-04: partidas por rubro
// ---------------------------------------------------------------------------------------------------------------------
describe('partidas por rubro (budget_items)', () => {
  type ItemRow = { id: string; budget_id: string; cost_category_id: string; amount: string; created_at: Date };
  const itemsRows = (budgetId: string): Promise<ItemRow[]> =>
    dataSource.query(`SELECT id, budget_id, cost_category_id, amount::text AS amount, created_at FROM budget_items WHERE budget_id = $1 ORDER BY cost_category_id`, [budgetId]);
  const itemsOfProject = (id: string) => count(`SELECT count(*)::int AS n FROM budget_items WHERE budget_id IN (SELECT id FROM budgets WHERE project_id = $1)`, [id]);
  const budgetId = async (project: string, version: number): Promise<string> =>
    (await dataSource.query(`SELECT id FROM budgets WHERE project_id = $1 AND version = $2`, [project, version]))[0].id as string;
  const split = (rrhh: string, lic: string, total: string, extra: Partial<CreateBudgetVersionDto> = {}): CreateBudgetVersionDto => ({
    expectedVersion: 1,
    totalAmount: total,
    currency: 'ARS',
    approvalDate: '2026-10-12',
    items: [
      { costCategoryId: cats.rrhh, amount: rrhh },
      { costCategoryId: cats.lic, amount: lic },
    ],
    ...extra,
  });
  const wrapManager = (intercept: (prop: string | symbol, target: object) => unknown) =>
    buildService({
      transaction: (run: (manager: unknown) => Promise<unknown>) =>
        dataSource.transaction(async (manager) =>
          run(
            new Proxy(manager, {
              get(target, prop, receiver) {
                return intercept(prop, target) ?? Reflect.get(target, prop, receiver);
              },
            }),
          ),
        ),
    });

  describe('alta inicial', () => {
    it('guarda presupuesto, partidas y auditoría; los importes quedan exactos', async () => {
      const created = await service.create(projectId, split('123456789000.10', '12.24', '123456789012.34'), adminActor);
      const rows = await itemsRows(created.id);
      expect(rows.map((r) => [r.cost_category_id, r.amount]).sort()).toEqual([[cats.lic, '12.24'], [cats.rrhh, '123456789000.10']].sort());
      expect(created.items).toEqual([
        { costCategoryId: cats.lic, categoryName: 'Licencias y software', amount: '12.24' },
        { costCategoryId: cats.rrhh, categoryName: 'Recursos humanos', amount: '123456789000.10' },
      ]);
      expect(await auditsOf(projectId)).toBe(1);
    });

    it('presupuesto, partidas y auditoría se confirman en LA MISMA transacción (mismo xmin)', async () => {
      const created = await service.create(projectId, dto, adminActor);
      const [{ same }] = await dataSource.query(
        `SELECT (SELECT xmin::text FROM budgets WHERE id = $1) = (SELECT DISTINCT xmin::text FROM budget_items WHERE budget_id = $1)
            AND (SELECT xmin::text FROM budgets WHERE id = $1) = (SELECT xmin::text FROM audit_logs WHERE entity_id = $1) AS same`,
        [created.id],
      );
      expect(same).toBe(true);
    });

    it('GET devuelve las partidas ordenadas por rubro', async () => {
      await service.create(projectId, dto, adminActor);
      const current = await service.getCurrent(projectId, adminActor);
      expect(current.items.map((i) => i.categoryName)).toEqual(['Licencias y software', 'Recursos humanos']);
    });

    it.each([
      ['suma menor', '1000000.49'],
      ['suma mayor', '1000000.51'],
    ])('%s: 400 BUDGET_ITEMS_TOTAL_MISMATCH y no queda nada', async (_label, rrhh) => {
      const error = (await service.create(projectId, split(rrhh, '500000.00', '1500000.50'), adminActor).catch((e: unknown) => e)) as BadRequestException;
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_ITEMS_TOTAL_MISMATCH', totalAmount: '1500000.50' });
      expect(await budgetsOf(projectId)).toBe(0);
      expect(await itemsOfProject(projectId)).toBe(0);
    });

    it('rubro duplicado: 400 y no queda nada', async () => {
      const body = withTotal('10.00', { items: [{ costCategoryId: cats.rrhh, amount: '5.00' }, { costCategoryId: cats.rrhh, amount: '5.00' }] });
      await expect(service.create(projectId, body, adminActor)).rejects.toMatchObject({ response: { code: 'BUDGET_ITEM_DUPLICATED_CATEGORY' } });
      expect(await budgetsOf(projectId)).toBe(0);
    });

    it('rubro inexistente: 400 COST_CATEGORY_NOT_FOUND y no queda nada (ni presupuesto ni partidas)', async () => {
      const body = withTotal('10.00', { items: [{ costCategoryId: '00000000-0000-4000-8000-000000000000', amount: '10.00' }] });
      await expect(service.create(projectId, body, adminActor)).rejects.toMatchObject({ response: { code: 'COST_CATEGORY_NOT_FOUND' } });
      expect(await budgetsOf(projectId)).toBe(0);
      expect(await auditsOf(projectId)).toBe(0);
    });

    it('rubro inactivo: 400 COST_CATEGORY_INACTIVE y no queda nada', async () => {
      const body = withTotal('10.00', { items: [{ costCategoryId: tempInactive, amount: '10.00' }] });
      await expect(service.create(projectId, body, adminActor)).rejects.toMatchObject({ response: { code: 'COST_CATEGORY_INACTIVE' } });
      expect(await budgetsOf(projectId)).toBe(0);
    });

    it('sin permiso: 403 y la base queda intacta', async () => {
      await expect(service.create(projectId, dto, collaboratorActor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await budgetsOf(projectId)).toBe(0);
      expect(await itemsOfProject(projectId)).toBe(0);
    });

    it('rollback si falla la inserción de las partidas: no queda el presupuesto', async () => {
      const failing = wrapManager((prop, target) =>
        prop === 'insert'
          ? async (entity: unknown, rows: unknown) => {
              if (entity === BudgetItemEntity) throw new Error('fallo simulado en las partidas');
              return (target as DataSource['manager']).insert(entity as never, rows as never);
            }
          : undefined,
      );
      await expect(failing.create(projectId, dto, adminActor)).rejects.toThrow('fallo simulado en las partidas');
      expect(await budgetsOf(projectId)).toBe(0);
      expect(await itemsOfProject(projectId)).toBe(0);
      expect(await auditsOf(projectId)).toBe(0);
      await expect(service.create(projectId, dto, adminActor)).resolves.toMatchObject({ version: 1 }); // el lock se liberó
    });

    it('rollback si falla la auditoría (con presupuesto y partidas ya insertados): no queda nada', async () => {
      const failing = wrapManager((prop, target) =>
        prop === 'save'
          ? async (row: object) => {
              if (row instanceof AuditLogEntity) throw new Error('fallo simulado en la auditoría');
              return (target as DataSource['manager']).save(row);
            }
          : undefined,
      );
      await expect(failing.create(projectId, dto, adminActor)).rejects.toThrow('fallo simulado en la auditoría');
      expect(await budgetsOf(projectId)).toBe(0);
      expect(await itemsOfProject(projectId)).toBe(0);
    });
  });

  describe('nuevas versiones', () => {
    beforeEach(async () => {
      await service.create(projectId, split('700000.00', '300000.00', '1000000.00'), adminActor); // V1: RRHH 700k + Licencias 300k
    });

    it('V2 tiene SUS PROPIAS partidas (ids nuevos) y las de V1 quedan intactas', async () => {
      const v1Id = await budgetId(projectId, 1);
      const before = await itemsRows(v1Id);
      const created = await service.createVersion(projectId, split('800000.00', '400000.00', '1200000.00'), adminActor);
      const after = await itemsRows(v1Id);
      const v2 = await itemsRows(created.id);

      expect(after).toEqual(before); // ids, importes, created_at: nada cambió
      expect(v2.map((r) => r.amount).sort()).toEqual(['400000.00', '800000.00']);
      const v1Ids = new Set(before.map((r) => r.id));
      expect(v2.every((r) => !v1Ids.has(r.id))).toBe(true); // ningún id reutilizado
      expect(v2.every((r) => r.budget_id === created.id)).toBe(true);
      expect(await itemsOfProject(projectId)).toBe(4);
    });

    it('con los MISMOS valores en otro orden: 409 BUDGET_NO_CHANGES y no se crean partidas', async () => {
      const body = split('300000.00', '700000.00', '1000000.00'); // cambia el orden del array Y la asignación? no: invertimos rubros
      body.items = [
        { costCategoryId: cats.lic, amount: '300000.00' },
        { costCategoryId: cats.rrhh, amount: '700000.00' },
      ];
      const error = (await service.createVersion(projectId, body, adminActor).catch((e: unknown) => e)) as ConflictException;
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CHANGES' });
      expect(await itemsOfProject(projectId)).toBe(2);
    });

    it('mismo encabezado y mismo total pero OTRA distribución (600/400): crea la versión 2', async () => {
      const created = await service.createVersion(projectId, split('600000.00', '400000.00', '1000000.00'), adminActor);
      expect(created).toMatchObject({ version: 2, totalAmount: '1000000.00' });
      expect(created.items.map((i) => i.amount).sort()).toEqual(['400000.00', '600000.00']);
    });

    it('moneda única: V1 y V2 quedan en la moneda del proyecto con sus partidas, y pedir otra moneda se rechaza sin convertir nada', async () => {
      await expect(service.createVersion(projectId, split('700000.00', '300000.00', '1000000.00', { currency: 'USD' }), adminActor)).rejects.toMatchObject({
        response: { code: 'PROJECT_CURRENCY_MISMATCH' },
      });
      const created = await service.createVersion(projectId, split('600000.00', '400000.00', '1000000.00', { currency: 'ARS' }), adminActor);
      const [v1, v2] = await dataSource.query(`SELECT currency, total_amount::text AS total FROM budgets WHERE project_id = $1 ORDER BY version`, [projectId]);
      expect(v1).toEqual({ currency: 'ARS', total: '1000000.00' });
      expect(v2).toEqual({ currency: 'ARS', total: '1000000.00' });
      expect((await itemsRows(await budgetId(projectId, 1))).map((r) => r.amount).sort()).toEqual(['300000.00', '700000.00']);
      expect(created.items.map((i) => i.amount).sort()).toEqual(['400000.00', '600000.00']);
    });

    it('un rubro que luego se desactiva sigue apareciendo con su nombre en la versión histórica (GET no filtra por active)', async () => {
      await dataSource.query(`UPDATE cost_categories SET active = false WHERE id = $1`, [tempActive]);
      // presupuesto histórico cargado directamente con el rubro temporal (cuando estaba activo)
      const other = await createProject(adminActor.id);
      await dataSource.query(`UPDATE cost_categories SET active = true WHERE id = $1`, [tempActive]);
      const created = await service.create(other, withTotal('50.00', { items: [{ costCategoryId: tempActive, amount: '50.00' }] }), adminActor);
      await dataSource.query(`UPDATE cost_categories SET active = false WHERE id = $1`, [tempActive]);
      try {
        const current = await service.getCurrent(other, adminActor);
        expect(current.id).toBe(created.id);
        expect(current.items).toEqual([{ costCategoryId: tempActive, categoryName: `zz-test-activo-${SUFFIX}`, amount: '50.00' }]);
      } finally {
        await dataSource.query(`UPDATE cost_categories SET active = true WHERE id = $1`, [tempActive]);
      }
    });

    it('expectedVersion desactualizado: 409 y no se crea ninguna partida', async () => {
      await service.createVersion(projectId, split('800000.00', '400000.00', '1200000.00'), adminActor); // V2
      const before = await itemsOfProject(projectId);
      const error = (await service
        .createVersion(projectId, split('1.00', '2.00', '3.00'), secondAdminActor) // sigue creyendo que es V1
        .catch((e: unknown) => e)) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_CONFLICT', currentVersion: 2 });
      expect(await itemsOfProject(projectId)).toBe(before);
    });

    it('validaciones del desglose: no tocan la versión vigente (V1 sigue vigente)', async () => {
      const bad = split('1.00', '1.00', '3.00'); // suma 2 ≠ 3
      await expect(service.createVersion(projectId, bad, adminActor)).rejects.toMatchObject({ response: { code: 'BUDGET_ITEMS_TOTAL_MISMATCH' } });
      await expect(
        service.createVersion(projectId, split('1.00', '1.00', '2.00', { items: [{ costCategoryId: tempInactive, amount: '2.00' }] }), adminActor),
      ).rejects.toMatchObject({ response: { code: 'COST_CATEGORY_INACTIVE' } });
      expect(await count(`SELECT count(*)::int AS n FROM budgets WHERE project_id = $1 AND is_current AND version = 1`, [projectId])).toBe(1);
      expect(await budgetsOf(projectId)).toBe(1);
    });

    it.each([
      ['la inserción del presupuesto (V1 ya desactivada)', (prop: string | symbol) => prop === 'save', (row: object) => row instanceof BudgetEntity],
      ['las partidas (V1 ya desactivada y V2 ya insertada)', (prop: string | symbol) => prop === 'insert', () => true],
      ['la auditoría (todo lo anterior ya insertado)', (prop: string | symbol) => prop === 'save', (row: object) => row instanceof AuditLogEntity],
    ])('rollback si falla %s: V1 sigue vigente e intacta, sin V2, sin partidas nuevas, sin auditoría', async (_label, match, failWhen) => {
      const v1Id = await budgetId(projectId, 1);
      const budgetBefore = JSON.stringify(await rowsAsText(`SELECT * FROM budgets WHERE project_id = $1 ORDER BY version`, [projectId]));
      const itemsBefore = JSON.stringify(await itemsRows(v1Id));
      const failing = wrapManager((prop, target) =>
        match(prop)
          ? async (...args: unknown[]) => {
              const row = args[prop === 'save' ? 0 : 1] as object;
              if (failWhen(row) && (prop !== 'insert' || args[0] === BudgetItemEntity)) throw new Error('fallo simulado');
              return (target as Record<string | symbol, (...a: unknown[]) => unknown>)[prop as string]!.apply(target, args);
            }
          : undefined,
      );

      await expect(failing.createVersion(projectId, split('800000.00', '400000.00', '1200000.00'), adminActor)).rejects.toThrow('fallo simulado');

      expect(JSON.stringify(await rowsAsText(`SELECT * FROM budgets WHERE project_id = $1 ORDER BY version`, [projectId]))).toBe(budgetBefore);
      expect(JSON.stringify(await itemsRows(v1Id))).toBe(itemsBefore);
      expect(await itemsOfProject(projectId)).toBe(2);
      expect(await count(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'BUDGET_VERSION_CREATED' AND new_values->>'projectId' = $1`, [projectId])).toBe(0);
    });

    it('auditoría con partidas: misma transacción que el presupuesto y las partidas; nada en project_activities', async () => {
      const created = await service.createVersion(projectId, split('800000.00', '400000.00', '1200000.00'), adminActor);
      const [{ same }] = await dataSource.query(
        `SELECT (SELECT xmin::text FROM budgets WHERE id = $1) = (SELECT DISTINCT xmin::text FROM budget_items WHERE budget_id = $1)
            AND (SELECT xmin::text FROM budgets WHERE id = $1) = (SELECT xmin::text FROM audit_logs WHERE entity_id = $1) AS same`,
        [created.id],
      );
      expect(same).toBe(true);
      const [audit] = await dataSource.query(`SELECT old_values, new_values FROM audit_logs WHERE entity_id = $1`, [created.id]);
      expect(audit.old_values.items.map((i: { amount: string }) => i.amount).sort()).toEqual(['300000.00', '700000.00']);
      expect(audit.new_values.items.map((i: { amount: string }) => i.amount).sort()).toEqual(['400000.00', '800000.00']);
      expect(await count(`SELECT count(*)::int AS n FROM project_activities WHERE project_id = $1`, [projectId])).toBe(0);
    });

    it('secuencia V1 → V2 → V3: cada versión conserva exactamente sus partidas', async () => {
      await service.createVersion(projectId, split('800000.00', '400000.00', '1200000.00'), adminActor);
      await service.createVersion(projectId, split('500000.00', '100000.00', '600000.00', { expectedVersion: 2 }), secondAdminActor);
      const rows: Array<{ version: number; amounts: string[] }> = [];
      for (const version of [1, 2, 3]) rows.push({ version, amounts: (await itemsRows(await budgetId(projectId, version))).map((r) => r.amount).sort() });
      expect(rows).toEqual([
        { version: 1, amounts: ['300000.00', '700000.00'] },
        { version: 2, amounts: ['400000.00', '800000.00'] },
        { version: 3, amounts: ['100000.00', '500000.00'] },
      ]);
    });

    describe('concurrencia', () => {
      it.each([2, 5])('%s versionados simultáneos con expectedVersion = 1: un ganador, el resto 409, sin partidas huérfanas, un solo vigente', async (parallel) => {
        const actors = [adminActor, secondAdminActor];
        const results = await Promise.allSettled(
          Array.from({ length: parallel }, (_, i) =>
            service.createVersion(projectId, split(`${i + 1}00.00`, `${i + 1}0.00`, `${(i + 1) * 110}.00`), actors[i % 2]!),
          ),
        );
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(rejected).toHaveLength(parallel - 1);
        for (const r of rejected) {
          expect(r.reason).toBeInstanceOf(ConflictException);
          expect((r.reason as ConflictException).getResponse()).toMatchObject({ code: 'BUDGET_VERSION_CONFLICT', currentVersion: 2 });
        }
        expect(await budgetsOf(projectId)).toBe(2);
        expect(await itemsOfProject(projectId)).toBe(4); // 2 de V1 + 2 de V2; los perdedores no dejaron nada
        expect(await count(`SELECT count(*)::int AS n FROM budgets WHERE project_id = $1 AND is_current`, [projectId])).toBe(1);
        expect(await count(`SELECT count(*)::int AS n FROM budget_items bi WHERE NOT EXISTS (SELECT 1 FROM budgets b WHERE b.id = bi.budget_id)`, [])).toBe(0);
        expect(await count(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'BUDGET_VERSION_CREATED' AND new_values->>'projectId' = $1`, [projectId])).toBe(1);
      });

      it('un rubro desactivado mientras se versiona: el FOR SHARE hace esperar al UPDATE hasta que la transacción termina', async () => {
        let deactivation: Promise<unknown> | undefined;
        let deactivated = false;
        let stillBlockedDuringTransaction = false;
        const spying = wrapManager((prop, target) =>
          prop === 'query'
            ? async (sql: string, params?: unknown[]) => {
                const result = await (target as DataSource['manager']).query(sql, params);
                if (sql.includes('FROM cost_categories')) {
                  // el servicio ya tiene el FOR SHARE: otra conexión intenta desactivar ese rubro
                  deactivation = dataSource.query(`UPDATE cost_categories SET active = false WHERE id = $1`, [tempActive]).then(() => {
                    deactivated = true;
                  });
                  await new Promise((resolve) => setTimeout(resolve, 400));
                  stillBlockedDuringTransaction = !deactivated;
                }
                return result;
              }
            : undefined,
        );

        try {
          const created = await spying.createVersion(
            projectId,
            split('1.00', '1.00', '2.00', { items: [{ costCategoryId: tempActive, amount: '1.00' }, { costCategoryId: cats.rrhh, amount: '1.00' }] }),
            adminActor,
          );
          expect(created.version).toBe(2);
          await deactivation;
          expect(stillBlockedDuringTransaction).toBe(true); // el UPDATE esperó a que la transacción confirmara
          expect(deactivated).toBe(true); // y se aplicó recién después
        } finally {
          await dataSource.query(`UPDATE cost_categories SET active = true WHERE id = $1`, [tempActive]);
        }
      });

      it('si el rubro ya estaba desactivado antes de empezar, la versión se rechaza (400) y V1 no se toca', async () => {
        await dataSource.query(`UPDATE cost_categories SET active = false WHERE id = $1`, [tempActive]);
        try {
          await expect(
            service.createVersion(projectId, split('1.00', '1.00', '2.00', { items: [{ costCategoryId: tempActive, amount: '2.00' }] }), adminActor),
          ).rejects.toMatchObject({ response: { code: 'COST_CATEGORY_INACTIVE' } });
        } finally {
          await dataSource.query(`UPDATE cost_categories SET active = true WHERE id = $1`, [tempActive]);
        }
        expect(await budgetsOf(projectId)).toBe(1);
      });
    });
  });

  /** Filas como texto para compararlas antes/después sin depender de tipos (fechas, numeric). */
  async function rowsAsText(sql: string, params: unknown[]): Promise<unknown[]> {
    return dataSource.query(`SELECT to_jsonb(t) AS r FROM (${sql}) t`, params);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// PRES-05: historial de presupuesto
// ---------------------------------------------------------------------------------------------------------------------
describe('getHistory: historial completo', () => {
  const body = (total: string, parts: Array<[string, string]>, extra: Partial<CreateBudgetVersionDto> = {}): CreateBudgetVersionDto => ({
    expectedVersion: 1,
    totalAmount: total,
    currency: 'ARS',
    approvalDate: '2026-10-25',
    items: parts.map(([costCategoryId, amount]) => ({ costCategoryId, amount })),
    ...extra,
  });

  /** V1 (ARS: RRHH 700k + Licencias 300k) → V2 (ARS: RRHH 800k + Licencias 400k) → V3 (ARS: RRHH 9.000,10 + temporal 0,90): la moneda es la del proyecto en todas. */
  async function threeVersions(creator: RequestUser = adminActor) {
    await service.create(projectId, body('1000000.00', [[cats.rrhh, '700000.00'], [cats.lic, '300000.00']]), creator);
    await service.createVersion(projectId, body('1200000.00', [[cats.rrhh, '800000.00'], [cats.lic, '400000.00']], { expectedVersion: 1 }), creator);
    await service.createVersion(
      projectId,
      body('9001.00', [[cats.rrhh, '9000.10'], [tempActive, '0.90']], { expectedVersion: 2, approvalDate: '2026-12-01' }),
      secondAdminActor,
    );
  }
  const amounts = (items: Array<{ amount: string }>) => items.map((i) => i.amount).sort();

  it('devuelve todas las versiones, version DESC, con SUS items, moneda y montos propios', async () => {
    await threeVersions();
    const history = await service.getHistory(projectId, adminActor);

    expect(history.map((h) => [h.version, h.isCurrent, h.currency, h.totalAmount])).toEqual([
      [3, true, 'ARS', '9001.00'],
      [2, false, 'ARS', '1200000.00'],
      [1, false, 'ARS', '1000000.00'],
    ]);
    expect(history.map((h) => amounts(h.items))).toEqual([['0.90', '9000.10'], ['400000.00', '800000.00'], ['300000.00', '700000.00']]);
    expect(history.map((h) => h.items.map((i) => i.categoryName))).toEqual([
      ['Recursos humanos', `zz-test-activo-${SUFFIX}`], // orden estable por nombre (comparación binaria)
      ['Licencias y software', 'Recursos humanos'],
      ['Licencias y software', 'Recursos humanos'],
    ]);
  });

  it('exactamente una vigente; V1 y V2 conservan supersededAt, V3 no lo tiene', async () => {
    await threeVersions();
    const history = await service.getHistory(projectId, adminActor);
    expect(history.filter((h) => h.isCurrent)).toHaveLength(1);
    expect(history[0]!.supersededAt).toBeNull();
    expect(history[1]!.supersededAt).toBe(history[0]!.createdAt); // V2 dejó de regir cuando nació V3 (now() de la transacción)
    expect(history[2]!.supersededAt).toBe(history[1]!.createdAt);
  });

  it('los ids de partidas históricas no se mezclan entre versiones y coinciden con budget_items', async () => {
    await threeVersions();
    const history = await service.getHistory(projectId, adminActor);
    for (const entry of history) {
      const rows: Array<{ cost_category_id: string; amount: string }> = await dataSource.query(
        `SELECT cost_category_id, amount::text AS amount FROM budget_items WHERE budget_id = $1`,
        [entry.id],
      );
      expect(rows.map((r) => `${r.cost_category_id}:${r.amount}`).sort()).toEqual(entry.items.map((i) => `${i.costCategoryId}:${i.amount}`).sort());
    }
    expect(new Set(history.map((h) => h.id)).size).toBe(3);
  });

  it('un rubro que hoy está INACTIVO sigue apareciendo con su nombre en la versión histórica', async () => {
    await threeVersions();
    await dataSource.query(`UPDATE cost_categories SET active = false WHERE id = $1`, [tempActive]);
    try {
      const history = await service.getHistory(projectId, adminActor);
      expect(history[0]!.items).toContainEqual({ costCategoryId: tempActive, categoryName: `zz-test-activo-${SUFFIX}`, amount: '0.90' });
    } finally {
      await dataSource.query(`UPDATE cost_categories SET active = true WHERE id = $1`, [tempActive]);
    }
  });

  it('precisión decimal exacta, como texto con 2 decimales', async () => {
    await service.create(projectId, body('123456789012.34', [[cats.rrhh, '123456789000.10'], [cats.lic, '12.24']]), adminActor);
    const [only] = await service.getHistory(projectId, adminActor);
    expect(only!.totalAmount).toBe('123456789012.34');
    expect(amounts(only!.items)).toEqual(['12.24', '123456789000.10']);
    expect(typeof only!.totalAmount).toBe('string');
  });

  it('devuelve quién creó cada versión (id y nombre), también si el usuario está dado de baja', async () => {
    const ghost = await createUser('ghost', [RoleName.ADMIN]);
    await service.create(projectId, body('10.00', [[cats.rrhh, '10.00']]), ghost);
    await service.createVersion(projectId, body('20.00', [[cats.rrhh, '20.00']]), adminActor);
    await dataSource.query(`UPDATE users SET active = false, deleted_at = now() WHERE id = $1`, [ghost.id]);

    const history = await service.getHistory(projectId, adminActor);
    expect(history[0]!.createdByUser).toEqual({ id: adminActor.id, name: 'admin' });
    expect(history[1]!.createdByUser).toEqual({ id: ghost.id, name: 'ghost' });
    expect(history[1]!.createdBy).toBe(ghost.id);
  });

  it('refleja una versión nueva apenas se crea (V4 pasa a ser la primera)', async () => {
    await threeVersions();
    await service.createVersion(projectId, body('5.00', [[cats.rrhh, '5.00']], { expectedVersion: 3 }), adminActor);
    const history = await service.getHistory(projectId, adminActor);
    expect(history.map((h) => h.version)).toEqual([4, 3, 2, 1]);
    expect(history[0]).toMatchObject({ isCurrent: true, currency: 'ARS' });
    expect(history[1]!.isCurrent).toBe(false);
  });

  it('proyecto sin presupuesto: 404 BUDGET_NOT_FOUND', async () => {
    await expect(service.getHistory(projectId, adminActor)).rejects.toMatchObject({ status: 404, response: { code: 'BUDGET_NOT_FOUND' } });
  });

  it('proyecto inexistente: 404', async () => {
    await expect(service.getHistory('00000000-0000-4000-8000-000000000000', adminActor)).rejects.toMatchObject({ status: 404 });
  });

  it('COLLABORATOR: 403 aunque el proyecto tenga historial', async () => {
    await threeVersions();
    await expect(service.getHistory(projectId, collaboratorActor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('líder real del proyecto ve el historial; un líder ajeno recibe 403', async () => {
    const leader = await createUser('lider', [RoleName.PROJECT_LEADER]);
    const foreign = await createUser('ajeno', [RoleName.PROJECT_LEADER]);
    const ledProject = await createProject(leader.id);
    await service.create(ledProject, body('10.00', [[cats.rrhh, '10.00']]), adminActor);
    await expect(service.getHistory(ledProject, leader)).resolves.toHaveLength(1);
    await expect(service.getHistory(ledProject, foreign)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no escribe nada ni toca audit_logs ni project_activities', async () => {
    await threeVersions();
    const countAudit = () => count(`SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'BUDGET'`, []);
    const before = await countAudit();
    await service.getHistory(projectId, adminActor);
    expect(await countAudit()).toBe(before);
    expect(await count(`SELECT count(*)::int AS n FROM project_activities WHERE project_id = $1`, [projectId])).toBe(0);
  });

  describe('integridad corrupta: se reporta, no se corrige', () => {
    beforeEach(async () => {
      await service.create(projectId, body('10.00', [[cats.rrhh, '10.00']]), adminActor);
    });

    it('versiones pero ninguna vigente: 500 BUDGET_NO_CURRENT_VERSION y los datos quedan como estaban', async () => {
      await dataSource.query(`UPDATE budgets SET is_current = false, superseded_at = now() WHERE project_id = $1`, [projectId]);
      const error = (await service.getHistory(projectId, adminActor).catch((e: unknown) => e)) as InternalServerErrorException;
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
      expect(await count(`SELECT count(*)::int AS n FROM budgets WHERE project_id = $1 AND is_current`, [projectId])).toBe(0); // no se "arregló"
    });

    it('la vigente no es la de mayor número: 500 BUDGET_VERSION_STATE_INVALID', async () => {
      await dataSource.query(
        `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, superseded_at, created_by) VALUES ($1, 5, 1.00, 'ARS', '2026-01-01', false, now(), $2)`,
        [projectId, adminActor.id],
      );
      const error = (await service.getHistory(projectId, adminActor).catch((e: unknown) => e)) as InternalServerErrorException;
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_STATE_INVALID' });
    });

    it('más de una vigente es imposible: lo impide el índice único parcial (no hace falta rama en la lectura de datos reales)', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, created_by) VALUES ($1, 2, 1.00, 'ARS', '2026-01-01', true, $2)`,
          [projectId, adminActor.id],
        ),
      ).rejects.toMatchObject({ driverError: { code: '23505' } });
    });
  });
});
