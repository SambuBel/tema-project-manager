import 'reflect-metadata';
import { QueryRunner } from 'typeorm';
import dataSource from '../data-source';
import { ProjectMemberEntity } from './project-member.entity';

/**
 * Garantías de `project_member_allocations` y del nuevo `project_members` (solo organizativo) contra PostgreSQL REAL (RES-02).
 *   pnpm --filter @tema/backend test:db
 * Cada caso corre dentro de una transacción que se REVIERTE al terminar: no deja ningún dato.
 */
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const FK_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';
const NUMERIC_OVERFLOW = '22003';

let runner: QueryRunner;
let userId: string;
let projectId: string;
let memberId: string;
let profileId: string;
let sequence = 0;

async function sqlState(action: () => Promise<unknown>): Promise<string | null> {
  await runner.query('SAVEPOINT attempt');
  try {
    await action();
    await runner.query('RELEASE SAVEPOINT attempt');
    return null;
  } catch (error) {
    await runner.query('ROLLBACK TO SAVEPOINT attempt');
    return (error as { driverError?: { code?: string } }).driverError?.code ?? 'desconocido';
  }
}

interface AllocationInput {
  member?: string;
  revision?: number;
  isCurrent?: boolean;
  supersededAt?: string | null;
  profile?: string | null;
  name?: string | null;
  rate?: string | null;
  currency?: string | null;
  hours?: string | null;
  cost?: string | null;
  budget?: string | null;
  changedBy?: string;
}

/** Por defecto: perfil completo (Senior USD 50), 100 h y costo 5000.00 coherente. */
const insertAllocation = (input: AllocationInput = {}) => {
  const v = {
    member: input.member ?? memberId,
    revision: input.revision ?? 1,
    isCurrent: input.isCurrent ?? true,
    supersededAt: 'supersededAt' in input ? input.supersededAt : null,
    profile: 'profile' in input ? input.profile : profileId,
    name: 'name' in input ? input.name : 'Senior',
    rate: 'rate' in input ? input.rate : '50.00',
    currency: 'currency' in input ? input.currency : 'USD',
    hours: 'hours' in input ? input.hours : '100.00',
    cost: 'cost' in input ? input.cost : '5000.00',
    budget: 'budget' in input ? input.budget : null,
    changedBy: input.changedBy ?? userId,
  };
  return runner.query(
    `INSERT INTO project_member_allocations
       (project_member_id, revision, is_current, superseded_at, resource_profile_id, profile_name_snapshot, hourly_cost_snapshot, currency_snapshot,
        estimated_hours, estimated_cost_snapshot, budget_id, changed_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, clock_timestamp()) RETURNING id`,
    [v.member, v.revision, v.isCurrent, v.supersededAt, v.profile, v.name, v.rate, v.currency, v.hours, v.cost, v.budget, v.changedBy],
  );
};

beforeAll(async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
});
afterAll(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});
beforeEach(async () => {
  runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const n = `${Date.now()}-${sequence++}`;
  [{ id: userId }] = await runner.query(`INSERT INTO users (email, name, active) VALUES ($1, 'Test', true) RETURNING id AS id`, [`alloc-test-${n}@tema-test.com`]);
  [{ id: projectId }] = await runner.query(
    `INSERT INTO projects (name, slug, status, leader_id, created_by) VALUES ($1, $2, 'PLANNED', $3, $3) RETURNING id AS id`,
    [`Alloc ${n}`, `alloc-${n}`, userId],
  );
  [{ id: memberId }] = await runner.query(
    `INSERT INTO project_members (project_id, user_id, project_role) VALUES ($1, $2, 'COLLABORATOR') RETURNING id AS id`,
    [projectId, userId],
  );
  [{ id: profileId }] = await runner.query(`INSERT INTO resource_profiles (name, hourly_cost, currency) VALUES ($1, 50, 'USD') RETURNING id AS id`, [`zz-alloc-${n}`]);
});
afterEach(async () => {
  await runner.rollbackTransaction();
  await runner.release();
});

describe('project_members es SOLO organizativo (RN-25 por construcción)', () => {
  it('no tiene ninguna columna económica', async () => {
    const rows: Array<{ column_name: string }> = await runner.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'project_members'`);
    expect(rows.map((r) => r.column_name).sort()).toEqual(['id', 'joined_at', 'project_id', 'project_role', 'removed_at', 'user_id']);
  });
  it('lo que devuelve GET members (la entidad completa) no puede incluir perfil, horas, tarifa ni costo', async () => {
    const members = await dataSource.getRepository(ProjectMemberEntity).find({ where: { projectId }, relations: ['user'] });
    const keys = Object.keys(members[0] ?? {});
    for (const forbidden of ['resourceProfileId', 'resourceProfile', 'estimatedHours', 'hourlyCost', 'currency', 'estimatedCost', 'budgetId']) {
      expect(keys).not.toContain(forbidden);
    }
  });
  it('FK con nombre fk_pm_project / fk_pm_user (y la de perfiles ya no existe)', async () => {
    const constraints: Array<{ conname: string; contype: string }> = await runner.query(`SELECT conname, contype FROM pg_constraint WHERE conrelid = 'project_members'::regclass`);
    expect(Object.fromEntries(constraints.map((c) => [c.conname, c.contype]))).toEqual({ pk_project_members: 'p', fk_pm_project: 'f', fk_pm_user: 'f' });
  });
});

describe('estructura de project_member_allocations', () => {
  it('columnas, tipos y nulabilidad (y SIN project_id duplicado)', async () => {
    const rows: Array<{ column_name: string; data_type: string; is_nullable: string; numeric_precision: number | null; numeric_scale: number | null; character_maximum_length: number | null }> =
      await runner.query(
        `SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale, character_maximum_length FROM information_schema.columns WHERE table_name = 'project_member_allocations'`,
      );
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(Object.keys(byName).sort()).toEqual(
      ['budget_id', 'changed_by', 'created_at', 'currency_snapshot', 'estimated_cost_snapshot', 'estimated_hours', 'hourly_cost_snapshot', 'id', 'is_current', 'origin',
        'profile_name_snapshot', 'project_member_id', 'resource_profile_id', 'revision', 'superseded_at'].sort(),
    );
    expect(byName.hourly_cost_snapshot).toMatchObject({ data_type: 'numeric', numeric_precision: 12, numeric_scale: 2, is_nullable: 'YES' });
    expect(byName.estimated_hours).toMatchObject({ data_type: 'numeric', numeric_precision: 8, numeric_scale: 2, is_nullable: 'YES' });
    expect(byName.estimated_cost_snapshot).toMatchObject({ data_type: 'numeric', numeric_precision: 18, numeric_scale: 2, is_nullable: 'YES' });
    expect(byName.currency_snapshot).toMatchObject({ character_maximum_length: 3, is_nullable: 'YES' });
    expect(byName.profile_name_snapshot).toMatchObject({ character_maximum_length: 150, is_nullable: 'YES' });
    for (const column of ['project_member_id', 'revision', 'is_current', 'changed_by', 'origin', 'created_at']) expect(byName[column]!.is_nullable).toBe('NO');
    for (const column of ['superseded_at', 'resource_profile_id', 'budget_id']) expect(byName[column]!.is_nullable).toBe('YES');
  });
  it('nombres de restricciones, índices y trigger', async () => {
    const constraints: Array<{ conname: string; contype: string }> = await runner.query(`SELECT conname, contype FROM pg_constraint WHERE conrelid = 'project_member_allocations'::regclass`);
    expect(Object.fromEntries(constraints.map((c) => [c.conname, c.contype]))).toEqual({
      pk_project_member_allocations: 'p',
      fk_pm_allocations_member: 'f',
      fk_pm_allocations_profile: 'f',
      fk_pm_allocations_budget: 'f',
      fk_pm_allocations_changed_by: 'f',
      ck_pm_allocations_revision_positive: 'c',
      ck_pm_allocations_current_not_superseded: 'c',
      ck_pm_allocations_profile_snapshot_consistent: 'c',
      ck_pm_allocations_currency_iso_format: 'c',
      ck_pm_allocations_hourly_cost_non_negative: 'c',
      ck_pm_allocations_estimated_hours_non_negative: 'c',
      ck_pm_allocations_estimated_cost_non_negative: 'c',
      ck_pm_allocations_cost_presence: 'c',
      ck_pm_allocations_cost_matches_inputs: 'c',
    });
    const indexes: Array<{ indexname: string; indexdef: string }> = await runner.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'project_member_allocations'`);
    expect(indexes.map((i) => i.indexname).sort()).toEqual(['pk_project_member_allocations', 'ux_pm_allocations_member_revision', 'ux_pm_allocations_one_current']);
    expect(indexes.find((i) => i.indexname === 'ux_pm_allocations_one_current')!.indexdef).toMatch(/WHERE.*is_current = true/);
    const triggers = await runner.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'project_member_allocations'::regclass AND NOT tgisinternal`);
    expect(triggers.map((t: { tgname: string }) => t.tgname)).toEqual(['tr_pm_allocations_immutable']);
  });
  it('origin usa el mismo enum que audit_logs y project_activities, con default UI', async () => {
    const [{ id }] = await insertAllocation();
    const [row] = await runner.query(`SELECT origin::text AS origin, pg_typeof(origin)::text AS type FROM project_member_allocations WHERE id = $1`, [id]);
    expect(row).toEqual({ origin: 'UI', type: 'audit_origin_enum' });
    expect(await sqlState(() => runner.query(`UPDATE project_member_allocations SET origin = 'AI' WHERE false`))).toBeNull(); // un futuro origin 'AI' ya cabe en el modelo
  });
});

describe('versionado', () => {
  it('UNIQUE(member, revision): una revisión no se repite', async () => {
    await insertAllocation({ revision: 1, isCurrent: false, supersededAt: '2026-10-25T10:00:00Z' });
    expect(await sqlState(() => insertAllocation({ revision: 1 }))).toBe(UNIQUE_VIOLATION);
  });
  it('UNIQUE parcial: UNA sola vigente por miembro; las históricas pueden ser muchas', async () => {
    await insertAllocation({ revision: 1 });
    expect(await sqlState(() => insertAllocation({ revision: 2 }))).toBe(UNIQUE_VIOLATION);
    await runner.query(`UPDATE project_member_allocations SET is_current = false, superseded_at = now() WHERE revision = 1`);
    expect(await sqlState(() => insertAllocation({ revision: 2 }))).toBeNull();
    expect(await sqlState(() => insertAllocation({ revision: 3, isCurrent: false, supersededAt: '2026-10-25T10:00:00Z' }))).toBeNull();
  });
  it('dos miembros distintos pueden tener cada uno su vigente', async () => {
    const [{ id: other }] = await runner.query(`INSERT INTO users (email, name, active) VALUES ($1, 'Otro', true) RETURNING id`, [`alloc-other-${Date.now()}-${sequence++}@tema-test.com`]);
    const [{ id: otherMember }] = await runner.query(`INSERT INTO project_members (project_id, user_id, project_role) VALUES ($1, $2, 'OBSERVER') RETURNING id`, [projectId, other]);
    await insertAllocation();
    expect(await sqlState(() => insertAllocation({ member: otherMember }))).toBeNull();
  });
  it('CHECK revision >= 1', async () => {
    expect(await sqlState(() => insertAllocation({ revision: 0 }))).toBe(CHECK_VIOLATION);
  });
  it('CHECK: una vigente no puede tener superseded_at', async () => {
    expect(await sqlState(() => insertAllocation({ isCurrent: true, supersededAt: '2026-10-25T10:00:00Z' }))).toBe(CHECK_VIOLATION);
  });
});

describe('snapshot del perfil', () => {
  it('perfil completo, o ninguno de los cuatro campos (todo o nada)', async () => {
    expect(await sqlState(() => insertAllocation({ profile: null, name: null, rate: null, currency: null, cost: null }))).toBeNull();
    for (const partial of [{ name: null }, { rate: null }, { currency: null }, { profile: null }] as AllocationInput[]) {
      expect(await sqlState(() => insertAllocation({ revision: 9, isCurrent: false, supersededAt: '2026-10-25T10:00:00Z', cost: null, ...partial }))).toBe(CHECK_VIOLATION);
    }
  });
  it.each(['usd', 'US', 'U1D', ''])('CHECK de formato de moneda rechaza %j', async (currency) => {
    expect(await sqlState(() => insertAllocation({ currency }))).toBe(CHECK_VIOLATION);
  });
  it('CHECK tarifa >= 0 (0 es válida)', async () => {
    expect(await sqlState(() => insertAllocation({ rate: '-0.01' }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => insertAllocation({ rate: '0.00', cost: '0.00' }))).toBeNull();
  });
  it('numeric exacto: la tarifa y las horas vuelven idénticas', async () => {
    const [{ id }] = await insertAllocation({ rate: '9999999999.99', hours: '0.00', cost: '0.00' });
    const [row] = await runner.query(`SELECT hourly_cost_snapshot::text AS rate, estimated_hours::text AS hours FROM project_member_allocations WHERE id = $1`, [id]);
    expect(row).toEqual({ rate: '9999999999.99', hours: '0.00' });
  });
  it('desborde: 11 enteros en la tarifa, 7 en las horas', async () => {
    expect(await sqlState(() => insertAllocation({ rate: '10000000000.00', cost: null, hours: null }))).toBe(NUMERIC_OVERFLOW);
    expect(await sqlState(() => insertAllocation({ hours: '1000000.00', cost: null }))).toBe(NUMERIC_OVERFLOW);
  });
});

describe('horas y costo estimado', () => {
  it('CHECK horas >= 0 (0.00 es válido)', async () => {
    expect(await sqlState(() => insertAllocation({ hours: '-0.01', cost: null }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => insertAllocation({ hours: '0.00', cost: '0.00' }))).toBeNull();
  });
  it('CHECK costo >= 0', async () => {
    expect(await sqlState(() => insertAllocation({ cost: '-1.00' }))).toBe(CHECK_VIOLATION);
  });
  it('el costo es NULL si falta cualquiera de los insumos, y NOT NULL si están los dos', async () => {
    expect(await sqlState(() => insertAllocation({ hours: null, cost: '5000.00' }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => insertAllocation({ profile: null, name: null, rate: null, currency: null, cost: '5000.00' }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => insertAllocation({ cost: null }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => insertAllocation({ hours: null, cost: null }))).toBeNull();
  });
  it('la base NO acepta un costo que contradiga sus propios insumos', async () => {
    expect(await sqlState(() => insertAllocation({ cost: '5000.01' }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => insertAllocation({ hours: '125.50', rate: '50.25', cost: '6306.37' }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => insertAllocation({ hours: '125.50', rate: '50.25', cost: '6306.38' }))).toBeNull();
  });
  it('el redondeo de la base es HALF-UP por asignación (round(numeric, 2))', async () => {
    const cases: Array<[string, string, string]> = [['0.01', '0.50', '0.01'], ['0.03', '0.50', '0.02'], ['0.05', '0.50', '0.03'], ['0.01', '0.49', '0.00'], ['125.50', '50.25', '6306.38']];
    for (const [hours, rate, expected] of cases) {
      const [{ cost }] = await runner.query(`SELECT round($1::numeric * $2::numeric, 2)::text AS cost`, [hours, rate]);
      expect(cost).toBe(expected);
    }
  });
  it('el máximo (999999.99 h × 9999999999.99) cabe en numeric(18,2)', async () => {
    expect(await sqlState(() => insertAllocation({ hours: '999999.99', rate: '9999999999.99', cost: '9999999899990000.00' }))).toBeNull();
  });
});

describe('claves foráneas', () => {
  const ghost = '00000000-0000-4000-8000-000000000000';
  it('rechazan miembro, perfil, presupuesto y usuario inexistentes', async () => {
    expect(await sqlState(() => insertAllocation({ member: ghost }))).toBe(FK_VIOLATION);
    expect(await sqlState(() => insertAllocation({ profile: ghost }))).toBe(FK_VIOLATION);
    expect(await sqlState(() => insertAllocation({ budget: ghost }))).toBe(FK_VIOLATION);
    expect(await sqlState(() => insertAllocation({ changedBy: ghost }))).toBe(FK_VIOLATION);
  });
  it('el presupuesto es opcional (NULL = no había vigente) y, si hay, se referencia por id', async () => {
    const [{ id: budgetId }] = await runner.query(
      `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, created_by) VALUES ($1, 1, 10, 'ARS', '2026-10-01', true, $2) RETURNING id`,
      [projectId, userId],
    );
    expect(await sqlState(() => insertAllocation({ budget: budgetId }))).toBeNull();
  });
  it('perfil → RESTRICT: no se puede borrar un perfil con asignaciones (ni siquiera históricas)', async () => {
    await insertAllocation({ isCurrent: false, supersededAt: '2026-10-25T10:00:00Z' });
    expect(await sqlState(() => runner.query(`DELETE FROM resource_profiles WHERE id = $1`, [profileId]))).toBe(FK_VIOLATION);
  });
  it('changed_by → RESTRICT: no se puede borrar al usuario que cambió una asignación', async () => {
    const [{ id: other }] = await runner.query(`INSERT INTO users (email, name, active) VALUES ($1, 'Otro', true) RETURNING id`, [`alloc-del-${Date.now()}-${sequence++}@tema-test.com`]);
    await insertAllocation({ changedBy: other });
    expect(await sqlState(() => runner.query(`DELETE FROM users WHERE id = $1`, [other]))).toBe(FK_VIOLATION);
  });
  it('miembro → CASCADE: borrar el miembro (o el proyecto) borra su historial, y el trigger no lo impide', async () => {
    await insertAllocation();
    expect(await sqlState(() => runner.query(`DELETE FROM project_members WHERE id = $1`, [memberId]))).toBeNull();
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM project_member_allocations WHERE project_member_id = $1`, [memberId]);
    expect(n).toBe(0);
  });
  it('borrar el proyecto con presupuesto referenciado arrastra todo sin trabarse', async () => {
    const [{ id: budgetId }] = await runner.query(
      `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, created_by) VALUES ($1, 1, 10, 'ARS', '2026-10-01', true, $2) RETURNING id`,
      [projectId, userId],
    );
    await insertAllocation({ budget: budgetId });
    expect(await sqlState(() => runner.query(`DELETE FROM projects WHERE id = $1`, [projectId]))).toBeNull();
  });
});

describe('inmutabilidad (trigger)', () => {
  it.each([
    ['revision', 'revision = 9'],
    ['resource_profile_id', 'resource_profile_id = NULL'],
    ['profile_name_snapshot', `profile_name_snapshot = 'Otro'`],
    ['hourly_cost_snapshot', 'hourly_cost_snapshot = 60'],
    ['currency_snapshot', `currency_snapshot = 'ARS'`],
    ['estimated_hours', 'estimated_hours = 120'],
    ['estimated_cost_snapshot', 'estimated_cost_snapshot = 6000'],
    ['budget_id', 'budget_id = NULL'],
    ['changed_by', 'changed_by = changed_by'],
    ['origin', `origin = 'AI'`],
    ['created_at', `created_at = created_at + interval '1 day'`],
  ])('rechaza UPDATE de %s (restrict_violation)', async (column, assignment) => {
    await insertAllocation();
    const sql = column === 'resource_profile_id'
      ? `UPDATE project_member_allocations SET resource_profile_id = NULL, profile_name_snapshot = NULL, hourly_cost_snapshot = NULL, currency_snapshot = NULL, estimated_cost_snapshot = NULL WHERE project_member_id = $1`
      : column === 'hourly_cost_snapshot' || column === 'estimated_hours'
        ? `UPDATE project_member_allocations SET ${assignment}, estimated_cost_snapshot = 6000 WHERE project_member_id = $1`
        : `UPDATE project_member_allocations SET ${assignment} WHERE project_member_id = $1`;
    expect(await sqlState(() => runner.query(sql, [memberId]))).toBe(RESTRICT_VIOLATION);
    const [row] = await runner.query(`SELECT revision, hourly_cost_snapshot::text AS rate, estimated_hours::text AS hours, estimated_cost_snapshot::text AS cost FROM project_member_allocations WHERE project_member_id = $1`, [memberId]);
    expect(row).toEqual({ revision: 1, rate: '50.00', hours: '100.00', cost: '5000.00' });
  });
  it('lo ÚNICO permitido: pasar la vigente a histórica (is_current true → false con superseded_at)', async () => {
    await insertAllocation();
    expect(await sqlState(() => runner.query(`UPDATE project_member_allocations SET is_current = false, superseded_at = clock_timestamp() WHERE project_member_id = $1`, [memberId]))).toBeNull();
  });
  it('una histórica no se puede reactivar ni modificar, y archivar sin superseded_at tampoco', async () => {
    await insertAllocation({ isCurrent: false, supersededAt: '2026-10-25T10:00:00Z' });
    expect(await sqlState(() => runner.query(`UPDATE project_member_allocations SET is_current = true, superseded_at = NULL WHERE project_member_id = $1`, [memberId]))).toBe(RESTRICT_VIOLATION);
    expect(await sqlState(() => runner.query(`UPDATE project_member_allocations SET superseded_at = now() WHERE project_member_id = $1`, [memberId]))).toBe(RESTRICT_VIOLATION);
    await insertAllocation({ revision: 2 });
    // archivar la vigente SIN superseded_at: lo rechaza el trigger (la fecha de reemplazo es obligatoria)
    expect(await sqlState(() => runner.query(`UPDATE project_member_allocations SET is_current = false WHERE project_member_id = $1 AND revision = 2`, [memberId]))).toBe(RESTRICT_VIOLATION);
  });
  it('un UPDATE que no cambia nada también se rechaza; INSERT y DELETE siguen permitidos', async () => {
    await insertAllocation();
    expect(await sqlState(() => runner.query(`UPDATE project_member_allocations SET revision = revision WHERE project_member_id = $1`, [memberId]))).toBe(RESTRICT_VIOLATION);
    expect(await sqlState(() => runner.query(`DELETE FROM project_member_allocations WHERE project_member_id = $1`, [memberId]))).toBeNull();
  });
  it('no hay valor NOT NULL violable: changed_by y project_member_id son obligatorios', async () => {
    expect(
      await sqlState(() =>
        runner.query(`INSERT INTO project_member_allocations (project_member_id, revision, is_current, created_at) VALUES ($1, 1, true, now())`, [memberId]),
      ),
    ).toBe(NOT_NULL_VIOLATION);
  });
});
