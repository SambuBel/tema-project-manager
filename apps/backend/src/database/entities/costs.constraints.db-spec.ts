import 'reflect-metadata';
import { QueryRunner } from 'typeorm';
import dataSource from '../data-source';

/**
 * Garantías de la tabla `costs` contra PostgreSQL REAL (COST-01). Necesita la base de desarrollo migrada:
 *   pnpm --filter @tema/backend test:db
 * Cada caso corre dentro de una transacción que se REVIERTE al terminar: no deja ningún dato.
 */
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const FK_VIOLATION = '23503';
const NUMERIC_OVERFLOW = '22003';

let runner: QueryRunner;
let userId: string;
let projectId: string;
let categoryId: string;
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

interface CostInput {
  amount?: string;
  currency?: string;
  costDate?: string;
  description?: string | null;
  taskId?: string | null;
  project?: string;
  category?: string;
  createdBy?: string;
}

const insertCost = (input: CostInput = {}) =>
  runner.query(
    `INSERT INTO costs (project_id, task_id, cost_category_id, amount, currency, cost_date, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, amount::text AS amount, deleted_at`,
    [
      input.project ?? projectId,
      input.taskId ?? null,
      input.category ?? categoryId,
      input.amount ?? '100.00',
      input.currency ?? 'ARS',
      input.costDate ?? '2026-10-25',
      'description' in input ? input.description : 'Licencias',
      input.createdBy ?? userId,
    ],
  );

async function insertTask(): Promise<string> {
  const n = `${Date.now()}-${sequence++}`;
  const [{ id }] = await runner.query(
    `INSERT INTO tasks (project_id, title, created_by, slug) VALUES ($1, 'Tarea', $2, $3) RETURNING id`,
    [projectId, userId, `tarea-${n}`],
  );
  return id as string;
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
  const n = `${Date.now()}-${sequence++}`;
  [{ id: userId }] = await runner.query(`INSERT INTO users (email, name, active) VALUES ($1, 'Test', true) RETURNING id AS id`, [`costs-test-${n}@tema-test.com`]);
  [{ id: projectId }] = await runner.query(
    `INSERT INTO projects (name, slug, status, leader_id, created_by) VALUES ($1, $2, 'PLANNED', $3, $3) RETURNING id AS id`,
    [`Costs test ${n}`, `costs-test-${n}`, userId],
  );
  [{ id: categoryId }] = await runner.query(`INSERT INTO cost_categories (name) VALUES ($1) RETURNING id AS id`, [`zz-costs-${n}`]);
});
afterEach(async () => {
  await runner.rollbackTransaction();
  await runner.release();
});

describe('estructura de costs', () => {
  it('columnas, tipos y nulabilidad', async () => {
    const rows: Array<{ column_name: string; data_type: string; is_nullable: string; numeric_precision: number | null; numeric_scale: number | null }> =
      await runner.query(`SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name = 'costs'`);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(Object.keys(byName).sort()).toEqual(
      ['amount', 'cost_category_id', 'cost_date', 'created_at', 'created_by', 'currency', 'deleted_at', 'description', 'id', 'project_id', 'revision', 'task_id', 'updated_at'].sort(),
    );
    expect(byName.amount).toMatchObject({ data_type: 'numeric', numeric_precision: 14, numeric_scale: 2, is_nullable: 'NO' });
    expect(byName.cost_date).toMatchObject({ data_type: 'date', is_nullable: 'NO' });
    expect(byName.description).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName.task_id!.is_nullable).toBe('YES');
    expect(byName.deleted_at!.is_nullable).toBe('YES');
    expect(byName.budget_id).toBeUndefined();
  });

  it('nombres de restricciones e índices', async () => {
    const constraints: Array<{ conname: string; contype: string }> = await runner.query(`SELECT conname, contype FROM pg_constraint WHERE conrelid = 'costs'::regclass`);
    expect(Object.fromEntries(constraints.map((c) => [c.conname, c.contype]))).toEqual({
      pk_costs: 'p',
      fk_costs_project: 'f',
      fk_costs_task: 'f',
      fk_costs_category: 'f',
      fk_costs_created_by: 'f',
      ck_costs_amount_non_negative: 'c',
      ck_costs_currency_iso_format: 'c',
      ck_costs_description_not_blank: 'c',
      ck_costs_revision_positive: 'c',
    });
    const indexes: Array<{ indexname: string }> = await runner.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'costs'`);
    expect(indexes.map((i) => i.indexname)).toContain('ix_costs_project_id');
  });
});

describe('importe', () => {
  it('CHECK amount >= 0: rechaza negativos, acepta 0', async () => {
    expect(await sqlState(() => insertCost({ amount: '-0.01' }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => insertCost({ amount: '0.00' }))).toBeNull();
  });
  it('numeric exacto: vuelve idéntico y 0.10 + 0.20 suma 0.30', async () => {
    const [{ amount }] = await insertCost({ amount: '123456789012.34' });
    expect(amount).toBe('123456789012.34');
    await insertCost({ amount: '0.10' });
    await insertCost({ amount: '0.20' });
    const [{ total }] = await runner.query(`SELECT SUM(amount)::text AS total FROM costs WHERE amount < 1`);
    expect(total).toBe('0.30');
  });
  it('13 enteros desbordan numeric(14,2)', async () => {
    expect(await sqlState(() => insertCost({ amount: '1000000000000.00' }))).toBe(NUMERIC_OVERFLOW);
  });
});

describe('moneda y descripción', () => {
  it.each(['ars', 'AR', 'A1S', 'AR ', ''])('CHECK de formato de moneda rechaza %j', async (currency) => {
    expect(await sqlState(() => insertCost({ currency }))).toBe(CHECK_VIOLATION);
  });
  it.each(['ARSS', ' ARS'])('más de 3 caracteres (%j) lo rechaza el varchar(3) antes que el CHECK', async (currency) => {
    expect(await sqlState(() => insertCost({ currency }))).toBe('22001');
  });
  it('acepta cualquier código de 3 letras mayúsculas (sin catálogo): también distinto del presupuesto', async () => {
    for (const currency of ['ARS', 'USD', 'EUR', 'XYZ']) expect(await sqlState(() => insertCost({ currency }))).toBeNull();
  });
  it('description NOT NULL', async () => {
    expect(await sqlState(() => insertCost({ description: null }))).toBe(NOT_NULL_VIOLATION);
  });
  it.each(['', ' ', '   '])('description no puede estar vacía ni ser solo espacios (%j)', async (description) => {
    expect(await sqlState(() => insertCost({ description }))).toBe(CHECK_VIOLATION);
  });
  it('btrim() solo recorta espacios: tabulaciones y saltos de línea los frena el trim() del DTO, no la base', async () => {
    expect(await sqlState(() => insertCost({ description: '\t\n' }))).toBeNull();
  });
  it('acepta textos largos (el tope de 500 es del DTO, no de la base)', async () => {
    expect(await sqlState(() => insertCost({ description: 'x'.repeat(2000) }))).toBeNull();
  });
});

describe('claves foráneas', () => {
  it('rechazan proyecto, rubro y creador inexistentes', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect(await sqlState(() => insertCost({ project: ghost }))).toBe(FK_VIOLATION);
    expect(await sqlState(() => insertCost({ category: ghost }))).toBe(FK_VIOLATION);
    expect(await sqlState(() => insertCost({ createdBy: ghost }))).toBe(FK_VIOLATION);
    expect(await sqlState(() => insertCost({ taskId: ghost }))).toBe(FK_VIOLATION);
  });
  it('task_id es opcional: un costo sin tarea es válido', async () => {
    const [{ id }] = await insertCost();
    const [{ task_id }] = await runner.query(`SELECT task_id FROM costs WHERE id = $1`, [id]);
    expect(task_id).toBeNull();
  });
  it('project → CASCADE: borrar el proyecto borra sus costos', async () => {
    await insertCost();
    expect(await sqlState(() => runner.query(`DELETE FROM projects WHERE id = $1`, [projectId]))).toBeNull();
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM costs WHERE project_id = $1`, [projectId]);
    expect(n).toBe(0);
  });
  it('task → SET NULL: borrar la tarea deja el costo con task_id NULL', async () => {
    const taskId = await insertTask();
    const [{ id }] = await insertCost({ taskId });
    await runner.query(`DELETE FROM tasks WHERE id = $1`, [taskId]);
    const [{ task_id }] = await runner.query(`SELECT task_id FROM costs WHERE id = $1`, [id]);
    expect(task_id).toBeNull();
  });
  it('category → RESTRICT: no se puede borrar un rubro con costos', async () => {
    await insertCost();
    expect(await sqlState(() => runner.query(`DELETE FROM cost_categories WHERE id = $1`, [categoryId]))).toBe(FK_VIOLATION);
  });
  it('created_by → RESTRICT: no se puede borrar un usuario que registró costos', async () => {
    const [{ id: other }] = await runner.query(`INSERT INTO users (email, name, active) VALUES ($1, 'Otro', true) RETURNING id`, [`costs-other-${Date.now()}-${sequence++}@tema-test.com`]);
    await insertCost({ createdBy: other });
    expect(await sqlState(() => runner.query(`DELETE FROM users WHERE id = $1`, [other]))).toBe(FK_VIOLATION);
  });
  it('el mismo rubro puede repetirse en muchos costos (no hay unicidad)', async () => {
    expect(await sqlState(() => insertCost())).toBeNull();
    expect(await sqlState(() => insertCost())).toBeNull();
    void UNIQUE_VIOLATION;
  });
});

describe('revision (token de concurrencia)', () => {
  it('es integer NOT NULL y nace en 1 por default', async () => {
    const [col] = await runner.query(`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'costs' AND column_name = 'revision'`);
    expect(col).toMatchObject({ data_type: 'integer', is_nullable: 'NO', column_default: '1' });
    const [{ id }] = await insertCost();
    const [{ revision }] = await runner.query(`SELECT revision FROM costs WHERE id = $1`, [id]);
    expect(revision).toBe(1);
  });
  it('CHECK revision >= 1: rechaza 0 y negativos', async () => {
    const [{ id }] = await insertCost();
    expect(await sqlState(() => runner.query(`UPDATE costs SET revision = 0 WHERE id = $1`, [id]))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => runner.query(`UPDATE costs SET revision = -3 WHERE id = $1`, [id]))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => runner.query(`UPDATE costs SET revision = revision + 1 WHERE id = $1`, [id]))).toBeNull();
  });
  it('revision = revision + 1 es atómico en una sola sentencia', async () => {
    const [{ id }] = await insertCost();
    await runner.query(`UPDATE costs SET revision = revision + 1 WHERE id = $1`, [id]);
    await runner.query(`UPDATE costs SET revision = revision + 1 WHERE id = $1`, [id]);
    const [{ revision }] = await runner.query(`SELECT revision FROM costs WHERE id = $1`, [id]);
    expect(revision).toBe(3);
  });
});

describe('baja lógica', () => {
  it('deleted_at nace NULL y la fila sigue existiendo al marcarla; updated_at tiene valor', async () => {
    const [{ id, deleted_at }] = await insertCost();
    expect(deleted_at).toBeNull();
    await runner.query(`UPDATE costs SET deleted_at = now() WHERE id = $1`, [id]);
    const [{ n, active }] = await runner.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE deleted_at IS NULL)::int AS active FROM costs WHERE id = $1`,
      [id],
    );
    expect([n, active]).toEqual([1, 0]);
    const [{ updated_at }] = await runner.query(`SELECT updated_at FROM costs WHERE id = $1`, [id]);
    expect(updated_at).toBeInstanceOf(Date);
  });
});
