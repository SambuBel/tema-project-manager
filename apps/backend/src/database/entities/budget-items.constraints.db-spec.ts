import 'reflect-metadata';
import { QueryRunner } from 'typeorm';
import dataSource from '../data-source';

/**
 * Garantías de `budget_items` y `cost_categories` contra PostgreSQL REAL (PRES-04). Necesita la base de desarrollo migrada:
 *   pnpm --filter @tema/backend test:db
 * Cada caso corre dentro de una transacción que se REVIERTE al terminar: no deja ningún dato.
 */
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FK_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';
const NUMERIC_OVERFLOW = '22003';

let runner: QueryRunner;
let userId: string;
let projectId: string;
let budgetId: string;
let categoryId: string;
let otherCategoryId: string;
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

async function insertCategory(name: string, active = true): Promise<string> {
  const [{ id }] = await runner.query(`INSERT INTO cost_categories (name, active) VALUES ($1, $2) RETURNING id`, [name, active]);
  return id as string;
}

async function insertBudget(version = 1): Promise<string> {
  const [{ id }] = await runner.query(
    `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, created_by) VALUES ($1, $2, 100.00, 'ARS', '2026-10-12', false, $3) RETURNING id`,
    [projectId, version, userId],
  );
  return id as string;
}

const insertItem = (amount: string, budget = budgetId, category = categoryId) =>
  runner.query(`INSERT INTO budget_items (budget_id, cost_category_id, amount) VALUES ($1, $2, $3) RETURNING id, amount::text AS amount`, [budget, category, amount]);

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
  [{ id: userId }] = await runner.query(`INSERT INTO users (email, name, active) VALUES ($1, 'Test', true) RETURNING id AS id`, [`items-test-${n}@tema-test.com`]);
  [{ id: projectId }] = await runner.query(
    `INSERT INTO projects (name, slug, status, leader_id, created_by) VALUES ($1, $2, 'PLANNED', $3, $3) RETURNING id AS id`,
    [`Items test ${n}`, `items-test-${n}`, userId],
  );
  budgetId = await insertBudget();
  categoryId = await insertCategory(`zz-rubro-a-${n}`);
  otherCategoryId = await insertCategory(`zz-rubro-b-${n}`);
});

afterEach(async () => {
  await runner.rollbackTransaction();
  await runner.release();
});

describe('estructura de budget_items', () => {
  it('columnas: SIN moneda propia (hereda la del presupuesto) y SIN updated_at (son inmutables)', async () => {
    const rows: Array<{ column_name: string; data_type: string; is_nullable: string; numeric_precision: number | null; numeric_scale: number | null }> =
      await runner.query(
        `SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name = 'budget_items'`,
      );
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(Object.keys(byName).sort()).toEqual(['amount', 'budget_id', 'cost_category_id', 'created_at', 'id']);
    expect(byName.amount).toMatchObject({ data_type: 'numeric', numeric_precision: 14, numeric_scale: 2, is_nullable: 'NO' });
    expect(byName.budget_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(byName.cost_category_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
  });

  it('nombres de restricciones, índice y trigger', async () => {
    const constraints: Array<{ conname: string; contype: string }> = await runner.query(
      `SELECT conname, contype FROM pg_constraint WHERE conrelid = 'budget_items'::regclass`,
    );
    expect(Object.fromEntries(constraints.map((c) => [c.conname, c.contype]))).toEqual({
      pk_budget_items: 'p',
      fk_budget_items_budget: 'f',
      fk_budget_items_category: 'f',
      ck_budget_items_amount_non_negative: 'c',
    });
    const [index] = await runner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'ux_budget_items_budget_category'`);
    expect(index.indexdef).toMatch(/UNIQUE.*\(budget_id, cost_category_id\)/);
    const triggers = await runner.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'budget_items'::regclass AND NOT tgisinternal`);
    expect(triggers.map((t: { tgname: string }) => t.tgname)).toEqual(['tr_budget_items_forbid_update']);
  });
});

describe('importes', () => {
  it('CHECK amount >= 0: rechaza negativos y acepta 0', async () => {
    expect(await sqlState(() => insertItem('-0.01'))).toBe(CHECK_VIOLATION);
    expect(await sqlState(() => insertItem('0.00'))).toBeNull();
  });

  it('numeric exacto: los valores vuelven idénticos (sin float)', async () => {
    const [{ amount }] = await insertItem('123456789012.34');
    expect(amount).toBe('123456789012.34');
  });

  it('la suma en SQL de 0.10 + 0.20 es exactamente 0.30', async () => {
    await insertItem('0.10');
    await insertItem('0.20', budgetId, otherCategoryId);
    const [{ total }] = await runner.query(`SELECT SUM(amount)::text AS total FROM budget_items WHERE budget_id = $1`, [budgetId]);
    expect(total).toBe('0.30');
  });

  it('13 dígitos enteros desbordan numeric(14,2)', async () => {
    expect(await sqlState(() => insertItem('1000000000000.00'))).toBe(NUMERIC_OVERFLOW);
  });
});

describe('unicidad y claves foráneas', () => {
  it('UNIQUE(budget_id, cost_category_id): un rubro una sola vez por versión', async () => {
    await insertItem('1.00');
    expect(await sqlState(() => insertItem('2.00'))).toBe(UNIQUE_VIOLATION);
  });

  it('el mismo rubro SÍ puede estar en distintas versiones (cada versión tiene sus propias filas)', async () => {
    const v2 = await insertBudget(2);
    await insertItem('1.00');
    expect(await sqlState(() => insertItem('1.00', v2))).toBeNull();
    const [{ n }] = await runner.query(`SELECT count(DISTINCT id)::int AS n FROM budget_items WHERE cost_category_id = $1`, [categoryId]);
    expect(n).toBe(2);
  });

  it('FK al presupuesto y al rubro: rechazan ids inexistentes', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect(await sqlState(() => insertItem('1.00', ghost))).toBe(FK_VIOLATION);
    expect(await sqlState(() => insertItem('1.00', budgetId, ghost))).toBe(FK_VIOLATION);
  });

  it('ON DELETE RESTRICT en el rubro: no se puede borrar un rubro con partidas', async () => {
    await insertItem('1.00');
    expect(await sqlState(() => runner.query(`DELETE FROM cost_categories WHERE id = $1`, [categoryId]))).toBe(FK_VIOLATION);
  });

  it('ON DELETE CASCADE desde el presupuesto: borrar el presupuesto borra SUS partidas (y el trigger no lo impide)', async () => {
    await insertItem('1.00');
    await insertItem('2.00', budgetId, otherCategoryId);
    expect(await sqlState(() => runner.query(`DELETE FROM budgets WHERE id = $1`, [budgetId]))).toBeNull();
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM budget_items WHERE budget_id = $1`, [budgetId]);
    expect(n).toBe(0);
  });

  it('borrar el proyecto arrastra presupuestos y partidas', async () => {
    await insertItem('1.00');
    expect(await sqlState(() => runner.query(`DELETE FROM projects WHERE id = $1`, [projectId]))).toBeNull();
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM budget_items WHERE budget_id = $1`, [budgetId]);
    expect(n).toBe(0);
  });
});

describe('inmutabilidad: el trigger impide UPDATE', () => {
  it.each([
    ['amount', `UPDATE budget_items SET amount = 999.00 WHERE budget_id = $1`],
    ['cost_category_id', `UPDATE budget_items SET cost_category_id = (SELECT id FROM cost_categories WHERE name LIKE 'zz-rubro-b-%' LIMIT 1) WHERE budget_id = $1`],
    ['budget_id', `UPDATE budget_items SET budget_id = budget_id WHERE budget_id = $1`],
    ['un UPDATE que no cambia nada', `UPDATE budget_items SET amount = amount WHERE budget_id = $1`],
  ])('rechaza UPDATE de %s (restrict_violation) y la fila no cambia', async (_label, sql) => {
    await insertItem('50.00');
    expect(await sqlState(() => runner.query(sql, [budgetId]))).toBe(RESTRICT_VIOLATION);
    const [{ amount }] = await runner.query(`SELECT amount::text AS amount FROM budget_items WHERE budget_id = $1`, [budgetId]);
    expect(amount).toBe('50.00');
  });

  it('el mensaje explica que el cambio es una versión nueva', async () => {
    await insertItem('50.00');
    await runner.query('SAVEPOINT m');
    const message = await runner.query(`UPDATE budget_items SET amount = 1 WHERE budget_id = $1`, [budgetId]).then(
      () => '',
      (error: Error) => error.message,
    );
    await runner.query('ROLLBACK TO SAVEPOINT m');
    expect(message).toMatch(/inmutable.*nueva versión/);
  });

  it('INSERT y DELETE siguen permitidos', async () => {
    expect(await sqlState(() => insertItem('1.00'))).toBeNull();
    expect(await sqlState(() => runner.query(`DELETE FROM budget_items WHERE budget_id = $1`, [budgetId]))).toBeNull();
  });

  it('un UPDATE que no alcanza ninguna fila no falla (el trigger es por fila)', async () => {
    expect(await sqlState(() => runner.query(`UPDATE budget_items SET amount = 1 WHERE false`))).toBeNull();
  });
});

describe('cost_categories', () => {
  it('los cinco rubros iniciales existen (garantizados por la migración)', async () => {
    const rows: Array<{ name: string; active: boolean }> = await runner.query(
      `SELECT name, active FROM cost_categories WHERE name IN ('Recursos humanos','Licencias y software','Servicios de terceros','Viáticos y traslados','Otros')`,
    );
    expect(rows.map((r) => r.name).sort()).toEqual(['Licencias y software', 'Otros', 'Recursos humanos', 'Servicios de terceros', 'Viáticos y traslados']);
  });

  it('unicidad sin distinguir mayúsculas: "OTROS" y "otros" no pueden coexistir con "Otros"', async () => {
    expect(await sqlState(() => insertCategory('OTROS'))).toBe(UNIQUE_VIOLATION);
    expect(await sqlState(() => insertCategory('otros'))).toBe(UNIQUE_VIOLATION);
    expect(await sqlState(() => insertCategory('Otros'))).toBe(UNIQUE_VIOLATION); // el UNIQUE(name) original sigue vigente
  });

  it('el índice case-insensitive existe y es sobre lower(name)', async () => {
    const [index] = await runner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'ux_cost_categories_name_lower'`);
    expect(index.indexdef).toMatch(/UNIQUE.*lower\(\(name\)::text\)/);
  });

  it('un rubro se desactiva sin perder sus partidas históricas (el nombre se sigue resolviendo)', async () => {
    await insertItem('10.00');
    await runner.query(`UPDATE cost_categories SET active = false WHERE id = $1`, [categoryId]);
    const [row] = await runner.query(
      `SELECT cc.name, cc.active, bi.amount::text AS amount FROM budget_items bi JOIN cost_categories cc ON cc.id = bi.cost_category_id WHERE bi.budget_id = $1`,
      [budgetId],
    );
    expect(row).toMatchObject({ active: false, amount: '10.00' });
    expect(row.name).toMatch(/^zz-rubro-a-/);
  });
});
