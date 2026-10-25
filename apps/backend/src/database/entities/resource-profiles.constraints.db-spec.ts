import 'reflect-metadata';
import { QueryRunner } from 'typeorm';
import dataSource from '../data-source';

/**
 * Garantías de `resource_profiles` contra PostgreSQL REAL (RES-01). Necesita la base de desarrollo migrada:
 *   pnpm --filter @tema/backend test:db
 * Cada caso corre dentro de una transacción que se REVIERTE al terminar: no deja ningún dato.
 */
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const NUMERIC_OVERFLOW = '22003';
const TOO_LONG = '22001';

let runner: QueryRunner;
let sequence = 0;
let tag: string;

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

const insertProfile = (input: { name?: string; hourly?: string; currency?: string; active?: boolean | undefined } = {}) =>
  runner.query(
    `INSERT INTO resource_profiles (name, hourly_cost, currency${input.active === undefined ? '' : ', active'}) VALUES ($1, $2, $3${input.active === undefined ? '' : ', $4'})
       RETURNING id, hourly_cost::text AS hourly, revision, active`,
    [input.name ?? `zz-${tag}`, input.hourly ?? '50.00', input.currency ?? 'USD', ...(input.active === undefined ? [] : [input.active])],
  );

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
  tag = `${Date.now()}-${sequence++}`;
});
afterEach(async () => {
  await runner.rollbackTransaction();
  await runner.release();
});

describe('estructura de resource_profiles', () => {
  it('columnas, tipos y nulabilidad (sin soft delete)', async () => {
    const rows: Array<{ column_name: string; data_type: string; is_nullable: string; numeric_precision: number | null; numeric_scale: number | null; column_default: string | null }> =
      await runner.query(`SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale, column_default FROM information_schema.columns WHERE table_name = 'resource_profiles'`);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(Object.keys(byName).sort()).toEqual(['active', 'created_at', 'currency', 'hourly_cost', 'id', 'name', 'revision', 'updated_at']);
    expect(byName.hourly_cost).toMatchObject({ data_type: 'numeric', numeric_precision: 12, numeric_scale: 2, is_nullable: 'NO' });
    expect(byName.revision).toMatchObject({ data_type: 'integer', is_nullable: 'NO', column_default: '1' });
    expect(byName.active).toMatchObject({ data_type: 'boolean', is_nullable: 'NO', column_default: 'true' });
    for (const column of ['name', 'currency']) expect(byName[column]!.is_nullable).toBe('NO');
  });

  it('nombres de restricciones e índices', async () => {
    const constraints: Array<{ conname: string; contype: string }> = await runner.query(`SELECT conname, contype FROM pg_constraint WHERE conrelid = 'resource_profiles'::regclass`);
    expect(Object.fromEntries(constraints.map((c) => [c.conname, c.contype]))).toEqual({
      pk_resource_profiles: 'p',
      ck_resource_profiles_hourly_cost_non_negative: 'c',
      ck_resource_profiles_name_not_blank: 'c',
      ck_resource_profiles_currency_iso_format: 'c',
      ck_resource_profiles_revision_positive: 'c',
    });
    const [index] = await runner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'ux_resource_profiles_name_currency'`);
    expect(index.indexdef).toMatch(/UNIQUE.*lower\(\(name\)::text\), currency/);
  });

  it('el enum de auditoría incluye RESOURCE_PROFILE (y conserva los anteriores)', async () => {
    const rows: Array<{ enumlabel: string }> = await runner.query(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'audit_entity_type_enum' ORDER BY enumsortorder`,
    );
    expect(rows.map((r) => r.enumlabel)).toEqual(['TASK', 'PROJECT', 'BUDGET', 'COST', 'RESOURCE_PROFILE']);
  });

  it('NO hay perfiles precargados (los de TEMA son ejemplos): el catálogo arranca vacío salvo lo que cree un administrador', async () => {
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM resource_profiles WHERE name IN ('Consultor Junior', 'Consultor Senior', 'Arquitecto')`);
    expect(n).toBe(0);
  });
});

describe('defaults', () => {
  it('revision nace en 1 y active en true', async () => {
    const [row] = await insertProfile();
    expect([row.revision, row.active]).toEqual([1, true]);
  });
});

describe('costo por hora', () => {
  it('CHECK >= 0: rechaza negativos y acepta 0 (TEMA no lo prohíbe)', async () => {
    expect(await sqlState(() => insertProfile({ hourly: '-0.01' }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => insertProfile({ hourly: '0.00', name: `zz-cero-${tag}` }))).toBeNull();
  });
  it('numeric exacto: vuelve idéntico', async () => {
    const [row] = await insertProfile({ hourly: '9999999999.99' });
    expect(row.hourly).toBe('9999999999.99');
  });
  it('11 dígitos enteros desbordan numeric(12,2)', async () => {
    expect(await sqlState(() => insertProfile({ hourly: '10000000000.00' }))).toBe(NUMERIC_OVERFLOW);
  });
  it('la suma en SQL es exacta: 125.50 horas × 50.25 = 6306.3750 (sin float)', async () => {
    const [{ product }] = await runner.query(`SELECT (125.50::numeric * 50.25::numeric)::text AS product`);
    expect(product).toBe('6306.3750');
  });
});

describe('nombre y moneda', () => {
  it.each(['', ' ', '   '])('CHECK de nombre no vacío rechaza %j', async (name) => {
    expect(await sqlState(() => insertProfile({ name }))).toBe(CHECK_VIOLATION);
  });
  it('acepta el nombre largo hasta 150 y rechaza 151', async () => {
    expect(await sqlState(() => insertProfile({ name: 'x'.repeat(150) }))).toBeNull();
    expect(await sqlState(() => insertProfile({ name: 'y'.repeat(151) }))).toBe(TOO_LONG);
  });
  it.each(['usd', 'US', 'U1D', 'US$', ''])('CHECK de formato de moneda rechaza %j', async (currency) => {
    expect(await sqlState(() => insertProfile({ currency }))).toBe(CHECK_VIOLATION);
  });
  it('NOT NULL en nombre, costo y moneda', async () => {
    for (const column of ['name', 'hourly_cost', 'currency']) {
      const values: Record<string, string | null> = { name: `zz-${tag}`, hourly_cost: '1.00', currency: 'USD', [column]: null };
      expect(
        await sqlState(() => runner.query(`INSERT INTO resource_profiles (name, hourly_cost, currency) VALUES ($1, $2, $3)`, [values.name, values.hourly_cost, values.currency])),
      ).toBe(NOT_NULL_VIOLATION);
    }
  });
});

describe('revision', () => {
  it('CHECK revision >= 1 y revision = revision + 1 atómico', async () => {
    const [{ id }] = await insertProfile();
    expect(await sqlState(() => runner.query(`UPDATE resource_profiles SET revision = 0 WHERE id = $1`, [id]))).toBe(CHECK_VIOLATION);
    await runner.query(`UPDATE resource_profiles SET revision = revision + 1 WHERE id = $1`, [id]);
    await runner.query(`UPDATE resource_profiles SET revision = revision + 1 WHERE id = $1`, [id]);
    expect((await runner.query(`SELECT revision FROM resource_profiles WHERE id = $1`, [id]))[0].revision).toBe(3);
  });
});

describe('unicidad (lower(name), currency)', () => {
  it('el mismo nombre en la misma moneda no puede repetirse, ni cambiando mayúsculas', async () => {
    await insertProfile({ name: `Consultor Senior ${tag}`, currency: 'USD' });
    expect(await sqlState(() => insertProfile({ name: `Consultor Senior ${tag}`, currency: 'USD' }))).toBe(UNIQUE_VIOLATION);
    expect(await sqlState(() => insertProfile({ name: `consultor senior ${tag}`, currency: 'USD' }))).toBe(UNIQUE_VIOLATION);
    expect(await sqlState(() => insertProfile({ name: `CONSULTOR SENIOR ${tag}`, currency: 'USD' }))).toBe(UNIQUE_VIOLATION);
  });
  it('el mismo nombre en monedas DISTINTAS sí puede existir (interpretación pendiente de TEMA)', async () => {
    await insertProfile({ name: `Consultor Senior ${tag}`, currency: 'USD', hourly: '50.00' });
    expect(await sqlState(() => insertProfile({ name: `Consultor Senior ${tag}`, currency: 'ARS', hourly: '40000.00' }))).toBeNull();
  });
  it('el texto original se conserva (la unicidad ignora mayúsculas, el dato no)', async () => {
    const [{ id }] = await insertProfile({ name: `consultor SENIOR ${tag}` });
    expect((await runner.query(`SELECT name FROM resource_profiles WHERE id = $1`, [id]))[0].name).toBe(`consultor SENIOR ${tag}`);
  });
  it('cambiar la moneda o el nombre de un perfil respeta la misma unicidad', async () => {
    await insertProfile({ name: `A ${tag}`, currency: 'USD' });
    const [{ id }] = await insertProfile({ name: `A ${tag}`, currency: 'ARS' });
    expect(await sqlState(() => runner.query(`UPDATE resource_profiles SET currency = 'USD' WHERE id = $1`, [id]))).toBe(UNIQUE_VIOLATION);
  });
  it('un perfil inactivo igual ocupa el nombre (no se pueden crear duplicados "escondidos")', async () => {
    await insertProfile({ name: `Inactivo ${tag}`, active: false });
    expect(await sqlState(() => insertProfile({ name: `inactivo ${tag}` }))).toBe(UNIQUE_VIOLATION);
  });
});

describe('active / referencias (las asignaciones viven en project_member_allocations desde RES-02)', () => {
  it('desactivar o cambiar un perfil asignado NO modifica la asignación (snapshot) ni project_members', async () => {
    const n = tag;
    const [{ id: userId }] = await runner.query(`INSERT INTO users (email, name, active) VALUES ($1, 'T', true) RETURNING id`, [`rp-${n}@tema-test.com`]);
    const [{ id: projectId }] = await runner.query(
      `INSERT INTO projects (name, slug, status, leader_id, created_by) VALUES ($1, $2, 'PLANNED', $3, $3) RETURNING id`,
      [`RP ${n}`, `rp-${n}`, userId],
    );
    const [{ id: profileId }] = await insertProfile();
    const [{ id: memberId }] = await runner.query(
      `INSERT INTO project_members (project_id, user_id, project_role) VALUES ($1, $2, 'COLLABORATOR') RETURNING id`,
      [projectId, userId],
    );
    await runner.query(
      `INSERT INTO project_member_allocations (project_member_id, revision, is_current, resource_profile_id, profile_name_snapshot, hourly_cost_snapshot, currency_snapshot, changed_by, created_at)
       VALUES ($1, 1, true, $2, 'Snapshot', 50, 'USD', $3, now())`,
      [memberId, profileId, userId],
    );
    await runner.query(`UPDATE resource_profiles SET active = false, hourly_cost = 99, currency = 'ARS', revision = revision + 1 WHERE id = $1`, [profileId]);
    const [allocation] = await runner.query(
      `SELECT resource_profile_id, hourly_cost_snapshot::text AS rate, currency_snapshot FROM project_member_allocations WHERE project_member_id = $1`,
      [memberId],
    );
    expect(allocation).toEqual({ resource_profile_id: profileId, rate: '50.00', currency_snapshot: 'USD' }); // sigue asociada con la tarifa histórica
  });
});
