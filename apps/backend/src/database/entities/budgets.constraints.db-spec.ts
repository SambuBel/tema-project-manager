import 'reflect-metadata';
import { QueryRunner } from 'typeorm';
import dataSource from '../data-source';

/**
 * Garantías de la tabla `budgets` contra PostgreSQL REAL (RN-18 / RNF-19). Necesita la base de desarrollo migrada:
 *   pnpm --filter @tema/backend test:db
 * No corre con `pnpm test` (el resto de los tests del repo no usa base). Cada caso se ejecuta dentro de una transacción
 * que se REVIERTE al terminar: no deja ningún dato.
 */
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const NUMERIC_OVERFLOW = '22003';

let runner: QueryRunner;
let userId: string;
let projectId: string;
let otherProjectId: string;
let sequence = 0;

async function insertProject(): Promise<string> {
  const n = `${Date.now()}-${sequence++}`;
  const [{ id }] = await runner.query(
    `INSERT INTO projects (name, slug, status, leader_id, created_by) VALUES ($1, $2, 'PLANNED', $3, $3) RETURNING id`,
    [`Presupuesto test ${n}`, `presupuesto-test-${n}`, userId],
  );
  return id as string;
}

interface BudgetInput {
  project?: string;
  version?: number;
  total?: string;
  currency?: string;
  approvalDate?: string | null;
  isCurrent?: boolean;
  supersededAt?: string | null;
}

async function insertBudget(input: BudgetInput = {}) {
  const values = {
    project: input.project ?? projectId,
    version: input.version ?? 1,
    total: input.total ?? '1000.00',
    currency: input.currency ?? 'USD',
    approvalDate: 'approvalDate' in input ? input.approvalDate : '2026-10-12',
    isCurrent: input.isCurrent ?? false,
    supersededAt: input.supersededAt ?? null,
  };
  return runner.query(
    `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, superseded_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, total_amount`,
    [values.project, values.version, values.total, values.currency, values.approvalDate, values.isCurrent, values.supersededAt, userId],
  );
}

/** Ejecuta la sentencia dentro de un SAVEPOINT y devuelve el código SQLSTATE con el que Postgres la rechazó (o null si pasó). */
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
  const [{ id }] = await runner.query(`INSERT INTO users (email, name, active) VALUES ($1, 'Test', true) RETURNING id`, [
    `budget-test-${Date.now()}-${sequence++}@tema-test.com`,
  ]);
  userId = id as string;
  projectId = await insertProject();
  otherProjectId = await insertProject();
});

afterEach(async () => {
  await runner.rollbackTransaction();
  await runner.release();
});

describe('estructura resultante de budgets', () => {
  it('columnas, tipos y nulabilidad', async () => {
    const rows: Array<{ column_name: string; data_type: string; is_nullable: string; numeric_precision: number | null; numeric_scale: number | null }> =
      await runner.query(
        `SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name = 'budgets'`,
      );
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));

    expect(Object.keys(byName).sort()).toEqual(
      ['approval_date', 'created_at', 'created_by', 'currency', 'id', 'is_current', 'project_id', 'superseded_at', 'total_amount', 'version'].sort(),
    );
    expect(byName.total_amount).toMatchObject({ data_type: 'numeric', numeric_precision: 14, numeric_scale: 2, is_nullable: 'NO' });
    expect(byName.approval_date).toMatchObject({ data_type: 'date', is_nullable: 'NO' });
    expect(byName.superseded_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES' });
    expect(byName.approved_at).toBeUndefined();
  });

  it('índices y CHECK con los nombres esperados', async () => {
    const indexes: Array<{ indexname: string; indexdef: string }> = await runner.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'budgets'`);
    const checks: Array<{ conname: string }> = await runner.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'budgets'::regclass AND contype = 'c'`);

    const byName = Object.fromEntries(indexes.map((i) => [i.indexname, i.indexdef]));
    expect(byName['ux_budgets_project_version']).toContain('UNIQUE');
    expect(byName['ux_budgets_one_current_per_project']).toMatch(/UNIQUE.*\(project_id\).*WHERE \(?is_current = true\)?/);
    expect(checks.map((c) => c.conname).sort()).toEqual([
      'ck_budgets_currency_iso_format',
      'ck_budgets_current_not_superseded',
      'ck_budgets_total_amount_non_negative',
      'ck_budgets_version_positive',
    ]);
  });
});

describe('UNIQUE(project_id, version)', () => {
  it('acepta versiones distintas del mismo proyecto y la misma versión en proyectos distintos', async () => {
    expect(await sqlState(() => insertBudget({ version: 1 }))).toBeNull();
    expect(await sqlState(() => insertBudget({ version: 2 }))).toBeNull();
    expect(await sqlState(() => insertBudget({ project: otherProjectId, version: 1 }))).toBeNull();
  });

  it('rechaza repetir (proyecto, versión)', async () => {
    await insertBudget({ version: 1 });
    expect(await sqlState(() => insertBudget({ version: 1 }))).toBe(UNIQUE_VIOLATION);
  });
});

describe('máximo UNA versión vigente por proyecto (índice parcial)', () => {
  it('rechaza una segunda versión vigente del mismo proyecto', async () => {
    await insertBudget({ version: 1, isCurrent: true });
    expect(await sqlState(() => insertBudget({ version: 2, isCurrent: true }))).toBe(UNIQUE_VIOLATION);
  });

  it('permite una vigente por CADA proyecto', async () => {
    await insertBudget({ version: 1, isCurrent: true });
    expect(await sqlState(() => insertBudget({ project: otherProjectId, version: 1, isCurrent: true }))).toBeNull();
  });

  it('permite varias versiones NO vigentes (el historial se conserva)', async () => {
    await insertBudget({ version: 1, supersededAt: '2026-10-12T10:00:00Z' });
    await insertBudget({ version: 2, supersededAt: '2026-10-12T11:00:00Z' });
    await insertBudget({ version: 3, isCurrent: true });
    const [{ count }] = await runner.query(`SELECT count(*)::int AS count FROM budgets WHERE project_id = $1`, [projectId]);
    expect(count).toBe(3);
  });

  it('flujo de nueva versión: primero se supera la vigente y recién después se inserta la nueva', async () => {
    const [{ id }] = await insertBudget({ version: 1, isCurrent: true });

    // al revés (insertar la nueva antes de superar la vieja) la base lo impide
    expect(await sqlState(() => insertBudget({ version: 2, isCurrent: true }))).toBe(UNIQUE_VIOLATION);

    await runner.query(`UPDATE budgets SET is_current = false, superseded_at = now() WHERE id = $1`, [id]);
    expect(await sqlState(() => insertBudget({ version: 2, isCurrent: true }))).toBeNull();

    const current: Array<{ version: number }> = await runner.query(`SELECT version FROM budgets WHERE project_id = $1 AND is_current`, [projectId]);
    expect(current).toEqual([{ version: 2 }]);
  });
});

describe('CHECK de importe, versión, moneda y vigencia', () => {
  it('total_amount negativo → rechazado; cero y positivos → aceptados', async () => {
    expect(await sqlState(() => insertBudget({ version: 1, total: '-0.01' }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => insertBudget({ version: 2, total: '0' }))).toBeNull();
    expect(await sqlState(() => insertBudget({ version: 3, total: '0.01' }))).toBeNull();
  });

  it.each([0, -1])('version %s → rechazada', async (version) => {
    expect(await sqlState(() => insertBudget({ version }))).toBe(CHECK_VIOLATION);
  });

  it.each(['usd', 'Usd', 'US', 'USDD', 'U$D', 'U D', '123', 'ÑAU', ''])('currency %j → rechazada', async (currency) => {
    // 'USDD' (4) no entra en varchar(3): falla por longitud (22001), el resto por el CHECK de formato (23514)
    const code = await sqlState(() => insertBudget({ version: 1, currency }));
    expect(code).not.toBeNull();
    expect(['22001', CHECK_VIOLATION]).toContain(code);
  });

  it.each(['USD', 'ARS', 'EUR', 'BRL', 'XXX'])('currency %s → aceptada (formato ISO; sin catálogo fijo)', async (currency) => {
    expect(await sqlState(() => insertBudget({ version: 1, currency }))).toBeNull();
  });

  it('versión vigente con superseded_at → rechazada', async () => {
    expect(await sqlState(() => insertBudget({ version: 1, isCurrent: true, supersededAt: '2026-10-12T10:00:00Z' }))).toBe(CHECK_VIOLATION);
  });

  it('versión vigente SIN superseded_at y versión no vigente (con o sin superseded_at) → aceptadas', async () => {
    expect(await sqlState(() => insertBudget({ version: 1, isCurrent: true }))).toBeNull();
    expect(await sqlState(() => insertBudget({ version: 2, supersededAt: '2026-10-12T10:00:00Z' }))).toBeNull();
    expect(await sqlState(() => insertBudget({ version: 3 }))).toBeNull();
  });

  it('marcar como vigente una versión que ya fue superada → rechazado', async () => {
    const [{ id }] = await insertBudget({ version: 1, supersededAt: '2026-10-12T10:00:00Z' });
    expect(await sqlState(() => runner.query(`UPDATE budgets SET is_current = true WHERE id = $1`, [id]))).toBe(CHECK_VIOLATION);
  });
});

describe('fecha de aprobación obligatoria', () => {
  it('approval_date NULL → rechazada (no hay borradores)', async () => {
    expect(await sqlState(() => insertBudget({ version: 1, approvalDate: null }))).toBe(NOT_NULL_VIOLATION);
  });

  it('es una fecha, sin hora ni zona: 2026-10-12 vuelve como 2026-10-12', async () => {
    await insertBudget({ version: 1, approvalDate: '2026-10-12' });
    const [row] = await runner.query(`SELECT approval_date::text AS approval_date FROM budgets WHERE project_id = $1`, [projectId]);
    expect(row.approval_date).toBe('2026-10-12');
  });
});

describe('importes exactos (RNF-19)', () => {
  it('conserva los centavos sin error de punto flotante', async () => {
    const [row] = await insertBudget({ version: 1, total: '0.30' });
    expect(row.total_amount).toBe('0.30'); // como string: sin pasar por Number

    const [{ sum }] = await runner.query(`SELECT (0.10::numeric + 0.20::numeric)::text AS sum`);
    expect(sum).toBe('0.30'); // en float 0.1 + 0.2 = 0.30000000000000004
  });

  it('guarda el máximo (12 enteros + 2 decimales) exacto y rechaza el desborde', async () => {
    const [row] = await insertBudget({ version: 1, total: '999999999999.99' });
    expect(row.total_amount).toBe('999999999999.99');
    expect(await sqlState(() => insertBudget({ version: 2, total: '1000000000000.00' }))).toBe(NUMERIC_OVERFLOW);
  });

  it('un importe muy grande no pierde dígitos (sería imposible en un double)', async () => {
    const [row] = await insertBudget({ version: 1, total: '123456789012.34' });
    expect(row.total_amount).toBe('123456789012.34');
  });
});

describe('integridad referencial', () => {
  it('borrar el proyecto borra sus versiones (CASCADE)', async () => {
    await insertBudget({ version: 1 });
    await runner.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    const [{ count }] = await runner.query(`SELECT count(*)::int AS count FROM budgets WHERE project_id = $1`, [projectId]);
    expect(count).toBe(0);
  });

  it('no se puede borrar al usuario que creó un presupuesto (RESTRICT)', async () => {
    await insertBudget({ version: 1 });
    const code = await sqlState(() => runner.query(`DELETE FROM users WHERE id = $1`, [userId]));
    expect(code).toBe('23503');
  });
});
