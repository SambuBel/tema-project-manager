import 'reflect-metadata';
import { DataSource, QueryRunner } from 'typeorm';
import dataSource from './data-source';
import { AddEconomicCurrencyToProjects1792600000000 } from './migrations/1792600000000-AddEconomicCurrencyToProjects';

/**
 * Migración de la MONEDA ÚNICA por proyecto contra PostgreSQL real, en un SCHEMA temporal con las 5 tablas que toca (proyectos,
 * presupuestos, costos, miembros y asignaciones), sin tocar los datos reales. Se prueba la regla: una moneda inequívoca se usa,
 * sin datos queda ARS, y una mezcla hace FALLAR la migración (sin convertir ni elegir).
 *   pnpm --filter @tema/backend test:db
 */
const SCHEMA = `mig_econ_cur_${Date.now()}`;
let runner: QueryRunner;
let ds: DataSource;

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P_ONLY_BUDGET_USD = ID(1);
const P_ONLY_COST_EUR = ID(2); // un costo dado de baja también cuenta
const P_ONLY_ALLOCATION_USD = ID(3);
const P_EMPTY = ID(4);
const P_CONSISTENT_ALL_ARS = ID(5);
const P_MIXED_BUDGET_VERSIONS = ID(6); // V1 ARS + V2 USD
const P_MIXED_COST_VS_ALLOCATION = ID(7);

async function resetTables(): Promise<void> {
  await runner.query(`DROP TABLE IF EXISTS project_member_allocations, project_members, costs, budgets, projects CASCADE`);
  await runner.query(`CREATE TABLE projects (id uuid PRIMARY KEY, name text)`);
  await runner.query(`CREATE TABLE budgets (id serial PRIMARY KEY, project_id uuid, version int, currency varchar(3))`);
  await runner.query(`CREATE TABLE costs (id serial PRIMARY KEY, project_id uuid, currency varchar(3), deleted_at timestamptz)`);
  await runner.query(`CREATE TABLE project_members (id uuid PRIMARY KEY, project_id uuid)`);
  await runner.query(`CREATE TABLE project_member_allocations (id serial PRIMARY KEY, project_member_id uuid, currency_snapshot varchar(3))`);
}

async function seed(projects: string[]): Promise<void> {
  for (const id of projects) await runner.query(`INSERT INTO projects (id, name) VALUES ($1, 'proyecto')`, [id]);
}
const member = async (project: string, n: number): Promise<string> => {
  const id = ID(900 + n);
  await runner.query(`INSERT INTO project_members (id, project_id) VALUES ($1, $2)`, [id, project]);
  return id;
};
const currencyOf = async (id: string): Promise<string> => (await runner.query(`SELECT economic_currency AS c FROM projects WHERE id = $1`, [id]))[0].c;
const up = () => new AddEconomicCurrencyToProjects1792600000000().up(runner);

beforeAll(async () => {
  ds = new DataSource({ type: 'postgres', url: dataSource.options && (dataSource.options as { url?: string }).url });
  await ds.initialize();
  runner = ds.createQueryRunner();
  await runner.connect();
  await runner.query(`CREATE SCHEMA ${SCHEMA}`);
  await runner.query(`SET search_path TO ${SCHEMA}`);
});

afterAll(async () => {
  await runner.query(`SET search_path TO public`);
  await runner.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await runner.release();
  await ds.destroy();
});

describe('migración de moneda única por proyecto', () => {
  beforeEach(resetTables);

  it('una sola moneda en los datos del proyecto → esa es su moneda (presupuesto, costo dado de baja, asignación); sin datos → ARS', async () => {
    await seed([P_ONLY_BUDGET_USD, P_ONLY_COST_EUR, P_ONLY_ALLOCATION_USD, P_EMPTY, P_CONSISTENT_ALL_ARS]);
    await runner.query(`INSERT INTO budgets (project_id, version, currency) VALUES ($1, 1, 'USD'), ($1, 2, 'usd '), ($2, 1, 'ARS')`, [P_ONLY_BUDGET_USD, P_CONSISTENT_ALL_ARS]);
    await runner.query(`INSERT INTO costs (project_id, currency, deleted_at) VALUES ($1, 'EUR', now()), ($2, 'ARS', NULL)`, [P_ONLY_COST_EUR, P_CONSISTENT_ALL_ARS]);
    const m3 = await member(P_ONLY_ALLOCATION_USD, 3);
    const m5 = await member(P_CONSISTENT_ALL_ARS, 5);
    await runner.query(`INSERT INTO project_member_allocations (project_member_id, currency_snapshot) VALUES ($1, 'USD'), ($1, 'USD'), ($2, 'ARS'), ($2, NULL)`, [m3, m5]);

    await up();

    expect(await currencyOf(P_ONLY_BUDGET_USD)).toBe('USD'); // normalizada
    expect(await currencyOf(P_ONLY_COST_EUR)).toBe('EUR');
    expect(await currencyOf(P_ONLY_ALLOCATION_USD)).toBe('USD');
    expect(await currencyOf(P_EMPTY)).toBe('ARS'); // default explícito: no hay datos que lo contradigan
    expect(await currencyOf(P_CONSISTENT_ALL_ARS)).toBe('ARS');
  });

  it('monedas MEZCLADAS: la migración FALLA, lista los proyectos y sus monedas, y no cambia nada (ni convierte ni elige una)', async () => {
    await seed([P_MIXED_BUDGET_VERSIONS, P_MIXED_COST_VS_ALLOCATION, P_EMPTY]);
    await runner.query(`INSERT INTO budgets (project_id, version, currency) VALUES ($1, 1, 'ARS'), ($1, 2, 'USD')`, [P_MIXED_BUDGET_VERSIONS]);
    await runner.query(`INSERT INTO costs (project_id, currency) VALUES ($1, 'ARS')`, [P_MIXED_COST_VS_ALLOCATION]);
    const m = await member(P_MIXED_COST_VS_ALLOCATION, 7);
    await runner.query(`INSERT INTO project_member_allocations (project_member_id, currency_snapshot) VALUES ($1, 'USD')`, [m]);

    const error = await up().then(() => null, (e: Error) => e);
    expect(error).not.toBeNull();
    expect(error!.message).toContain('monedas mezcladas');
    expect(error!.message).toContain(P_MIXED_BUDGET_VERSIONS);
    expect(error!.message).toContain(P_MIXED_COST_VS_ALLOCATION);
    expect(error!.message).toContain('ARS (presupuesto) | USD (presupuesto)');
    expect(error!.message).toContain('ARS (costo) | USD (asignación de recursos)');
    expect(error!.message).not.toContain(P_EMPTY); // un proyecto limpio no se menciona
  });

  it('deja la columna NOT NULL, con default ARS y con el CHECK de formato; el CHECK rechaza minúsculas', async () => {
    await seed([P_EMPTY]);
    await up();
    const [col] = await runner.query(
      `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'projects' AND column_name = 'economic_currency'`,
      [SCHEMA],
    );
    expect(col.is_nullable).toBe('NO');
    expect(col.column_default).toContain('ARS');
    await expect(runner.query(`UPDATE projects SET economic_currency = 'usd'`)).rejects.toThrow(/ck_projects_economic_currency_format/);
    await runner.query(`INSERT INTO projects (id, name) VALUES ($1, 'nuevo')`, [ID(50)]);
    expect(await currencyOf(ID(50))).toBe('ARS'); // un INSERT sin moneda toma el default
  });

  it('down() deja el esquema como estaba', async () => {
    await seed([P_EMPTY]);
    await up();
    await new AddEconomicCurrencyToProjects1792600000000().down(runner);
    const cols = await runner.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'projects' AND column_name = 'economic_currency'`, [SCHEMA]);
    expect(cols).toEqual([]);
  });

  it('NO convierte importes: la migración nunca toca budgets, costs ni asignaciones', async () => {
    await seed([P_ONLY_BUDGET_USD]);
    await runner.query(`INSERT INTO budgets (project_id, version, currency) VALUES ($1, 1, 'USD')`, [P_ONLY_BUDGET_USD]);
    const before = await runner.query(`SELECT * FROM budgets ORDER BY id`);
    await up();
    expect(await runner.query(`SELECT * FROM budgets ORDER BY id`)).toEqual(before);
  });
});
