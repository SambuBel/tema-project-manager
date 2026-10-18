import 'reflect-metadata';
import { ConflictException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import dataSource from '../database/data-source';
import { BudgetsService } from './budgets.service';
import { PermissionsService } from '../auth/permissions.service';
import { BudgetEntity } from '../database/entities/budget.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

/**
 * BudgetsService contra PostgreSQL REAL: concurrencia, atomicidad con audit_logs y regla is_current.
 *   pnpm --filter @tema/backend test:db
 * A diferencia de budgets.constraints.db-spec.ts, acá el servicio abre SUS PROPIAS transacciones (se confirman), así que
 * los datos de prueba se crean y se BORRAN explícitamente (suffix único: no toca datos reales).
 */
const SUFFIX = `pres02-${Date.now()}`;
const dto = { totalAmount: '1500000.50', currency: 'ARS', approvalDate: '2026-10-12' };

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
});

beforeEach(async () => {
  projectId = await createProject(adminActor.id);
});

afterAll(async () => {
  // audit_logs.entity_id no tiene FK: se borra por los ids de presupuesto ANTES de que el proyecto arrastre los budgets
  await dataSource.query(`DELETE FROM audit_logs WHERE entity_type = 'BUDGET' AND entity_id IN (SELECT id FROM budgets WHERE project_id = ANY($1::uuid[]))`, [projectIds]);
  await dataSource.query(`DELETE FROM projects WHERE id = ANY($1::uuid[])`, [projectIds]);
  await dataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  if (dataSource.isInitialized) await dataSource.destroy();
});

describe('POST: presupuesto inicial', () => {
  it('crea la versión 1 vigente, con el importe exacto', async () => {
    const created = await service.create(projectId, { ...dto, totalAmount: '123456789012.34' }, adminActor);

    const [row] = await dataSource.query(
      `SELECT version, is_current, superseded_at, total_amount::text AS total, currency, approval_date::text AS approval_date, created_by FROM budgets WHERE id = $1`,
      [created.id],
    );
    expect(row).toEqual({ version: 1, is_current: true, superseded_at: null, total: '123456789012.34', currency: 'ARS', approval_date: '2026-10-12', created_by: adminActor.id });
    expect(created).toMatchObject({ version: 1, isCurrent: true, supersededAt: null, totalAmount: '123456789012.34', approvalDate: '2026-10-12' });
  });

  it('el importe sin decimales queda con 2 decimales exactos en la base', async () => {
    const created = await service.create(projectId, { ...dto, totalAmount: '1000.00' }, adminActor);
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
      new_values: { projectId, version: 1, totalAmount: '1500000.50', currency: 'ARS', approvalDate: '2026-10-12' },
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
    const error = await service.create(projectId, { ...dto, totalAmount: '5.00' }, adminActor).catch((e: unknown) => e);

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
      Array.from({ length: parallel }, (_, i) => service.create(projectId, { ...dto, totalAmount: `${i + 1}00.00` }, actors[i % 2]!)),
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
  const next = { expectedVersion: 1, totalAmount: '1200000.00', currency: 'ARS', approvalDate: '2026-11-01' };
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
    await service.create(projectId, { ...dto, totalAmount: '1000000.00' }, adminActor);
  });

  it('V1 queda histórica, V2 vigente, supersededAt = createdAt de V2 y V1 intacta salvo is_current/superseded_at', async () => {
    const before = (await rowsOf(projectId))[0];
    const created = await service.createVersion(projectId, { ...next, currency: 'USD' }, adminActor);
    const [v1, v2] = await rowsOf(projectId);

    expect(created).toMatchObject({ version: 2, isCurrent: true, supersededAt: null, currency: 'USD', totalAmount: '1200000.00' });
    expect(v1).toEqual({ ...before, is_current: false, superseded_at: expect.any(Date) });
    expect(v1.superseded_at.getTime()).toBe(v2.created_at.getTime());
    expect(v2).toMatchObject({ version: 2, is_current: true, superseded_at: null, created_by: adminActor.id });
    expect(await count(`SELECT count(*)::int AS n FROM budgets WHERE project_id = $1 AND is_current`, [projectId])).toBe(1);
  });

  it('secuencia V1 → V2 → V3; la vigente siempre coincide con MAX(version)', async () => {
    expect(await currentMatchesMax(projectId)).toBe(true);
    await service.createVersion(projectId, next, adminActor);
    expect(await currentMatchesMax(projectId)).toBe(true);
    await service.createVersion(projectId, { ...next, expectedVersion: 2, totalAmount: '900000.00' }, secondAdminActor);
    expect(await currentMatchesMax(projectId)).toBe(true);

    const rows = await rowsOf(projectId);
    expect(rows.map((r: { version: number; is_current: boolean }) => [r.version, r.is_current])).toEqual([[1, false], [2, false], [3, true]]);
    expect(rows.map((r: { total: string }) => r.total)).toEqual(['1000000.00', '1200000.00', '900000.00']);
    await expect(service.getCurrent(projectId, adminActor)).resolves.toMatchObject({ version: 3, totalAmount: '900000.00' });
  });

  it('el cambio de moneda entre versiones está permitido', async () => {
    await expect(service.createVersion(projectId, { ...next, totalAmount: '1000000.00', approvalDate: '2026-10-12', currency: 'USD' }, adminActor)).resolves.toMatchObject({
      version: 2,
      currency: 'USD',
    });
  });

  it('precisión decimal intacta en V1 y V2', async () => {
    await service.createVersion(projectId, { ...next, totalAmount: '123456789012.34' }, adminActor);
    await service.createVersion(projectId, { ...next, expectedVersion: 2, totalAmount: '0.10' }, adminActor);
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
      old_values: { budgetId: v1Row.id, projectId, version: 1, totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-12' },
      new_values: { budgetId: created.id, projectId, version: 2, totalAmount: '1200000.00', currency: 'ARS', approvalDate: '2026-11-01' },
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
      const error = await service.createVersion(projectId, { ...next, totalAmount: '5.00' }, secondAdminActor).catch((e: unknown) => e); // sigue creyendo que es V1
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'BUDGET_VERSION_CONFLICT', currentVersion: 2 });
      expect(await snapshot()).toBe(before);
    });

    it('sin cambios: 409 BUDGET_NO_CHANGES', async () => {
      const before = await snapshot();
      const error = await service
        .createVersion(projectId, { expectedVersion: 1, totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-12' }, adminActor)
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
        Array.from({ length: parallel }, (_, i) => service.createVersion(projectId, { ...next, totalAmount: `${i + 1}00.00` }, actors[i % 2]!)),
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
        await service.createVersion(projectId, { ...next, expectedVersion: version, totalAmount: `${version + 1}.00` }, adminActor);
      }
      running = false;
      await reader;
      expect([...observed]).toEqual([1]);
      expect(await currentMatchesMax(projectId)).toBe(true);
    });

    it('versionados de proyectos distintos no se bloquean entre sí', async () => {
      const other = await createProject(adminActor.id);
      await service.create(other, dto, adminActor);
      const results = await Promise.all([service.createVersion(projectId, next, adminActor), service.createVersion(other, { ...next, totalAmount: '7.00' }, secondAdminActor)]);
      expect(results.map((r) => r.version)).toEqual([2, 2]);
    });
  });
});
