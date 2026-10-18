import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { BudgetEntity } from './budget.entity';

/**
 * Mapeo de BudgetEntity SIN conectarse a la base: los índices, CHECK y FK declarados acá tienen que coincidir con los
 * de la base. Si falta alguno, `typeorm migration:generate` propone BORRARLO (incluido el índice parcial de RN-18).
 * (La verificación contra Postgres real está en budgets.constraints.db-spec.ts.)
 */
describe('BudgetEntity - metadata', () => {
  const ds = new DataSource({ type: 'postgres', entities: [__dirname + '/../../**/*.entity.ts'] });
  let meta: ReturnType<DataSource['getMetadata']>;

  beforeAll(async () => {
    // buildMetadatas es el paso que arma el metadata sin abrir ninguna conexión
    await (ds as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
    meta = ds.getMetadata(BudgetEntity);
  });

  const column = (name: string) => meta.columns.find((c) => c.databaseName === name)!;

  it('tabla budgets', () => {
    expect(meta.tableName).toBe('budgets');
  });

  it('totalAmount es numeric(14,2) y string en TypeScript (RNF-19: nunca float)', () => {
    const total = column('total_amount');
    expect(total.type).toBe('numeric');
    expect([total.precision, total.scale]).toEqual([14, 2]);
    expect(total.isNullable).toBe(false);
    const design = Reflect.getMetadata('design:type', BudgetEntity.prototype, 'totalAmount');
    expect(design).toBe(String);
    expect(design).not.toBe(Number);
  });

  it('approval_date es DATE NOT NULL (sin hora, sin borradores)', () => {
    const approval = column('approval_date');
    expect(approval.type).toBe('date');
    expect(approval.isNullable).toBe(false);
    expect(meta.columns.some((c) => c.databaseName === 'approved_at')).toBe(false);
  });

  it('superseded_at es timestamptz NULL', () => {
    const superseded = column('superseded_at');
    expect(superseded.type).toBe('timestamptz');
    expect(superseded.isNullable).toBe(true);
  });

  it('currency es varchar(3) NOT NULL; version integer; is_current default false', () => {
    expect([column('currency').type, column('currency').length, column('currency').isNullable]).toEqual(['varchar', '3', false]);
    expect(column('version').type).toBe('integer');
    expect(column('is_current').default).toBe(false);
  });

  it('las columnas que ya existían se mantienen', () => {
    const names = meta.columns.map((c) => c.databaseName).sort();
    expect(names).toEqual(
      ['approval_date', 'created_at', 'created_by', 'currency', 'id', 'is_current', 'project_id', 'superseded_at', 'total_amount', 'version'].sort(),
    );
  });

  it('UNIQUE(project_id, version) con el nombre real de la base', () => {
    const index = meta.indices.find((i) => i.name === 'ux_budgets_project_version')!;
    expect(index.isUnique).toBe(true);
    expect(index.columns.map((c) => c.databaseName)).toEqual(['project_id', 'version']);
  });

  it('índice único PARCIAL: una sola versión vigente por proyecto (RN-18)', () => {
    const index = meta.indices.find((i) => i.name === 'ux_budgets_one_current_per_project')!;
    expect(index.isUnique).toBe(true);
    expect(index.columns.map((c) => c.databaseName)).toEqual(['project_id']);
    expect(index.where).toBe('"is_current" = true');
  });

  it('los 4 CHECK, con los nombres reales de la base', () => {
    const checks = Object.fromEntries(meta.checks.map((c) => [c.name, c.expression]));
    expect(Object.keys(checks).sort()).toEqual([
      'ck_budgets_currency_iso_format',
      'ck_budgets_current_not_superseded',
      'ck_budgets_total_amount_non_negative',
      'ck_budgets_version_positive',
    ]);
    expect(checks['ck_budgets_currency_iso_format']).toContain('^[A-Z]{3}$');
    expect(checks['ck_budgets_current_not_superseded']).toContain('"superseded_at" IS NULL');
  });

  it('FK con los nombres reales: proyecto (CASCADE) y creador (RESTRICT)', () => {
    const fks = Object.fromEntries(meta.foreignKeys.map((fk) => [fk.name, [fk.columnNames.join(','), fk.onDelete]]));
    expect(fks).toEqual({
      fk_budgets_project: ['project_id', 'CASCADE'],
      fk_budgets_created_by: ['created_by', 'RESTRICT'],
    });
  });
});
