import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { CostEntity } from './cost.entity';

/**
 * Mapeo de CostEntity SIN conectarse a la base: lo declarado acá tiene que coincidir con PostgreSQL o `schema:log` propone
 * borrar los CHECK y renombrar las FK. La verificación contra Postgres real está en costs.constraints.db-spec.ts.
 */
describe('CostEntity - metadata', () => {
  const ds = new DataSource({ type: 'postgres', entities: [__dirname + '/../../**/*.entity.ts'] });
  let meta: ReturnType<DataSource['getMetadata']>;

  beforeAll(async () => {
    await (ds as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
    meta = ds.getMetadata(CostEntity);
  });
  const column = (name: string) => meta.columns.find((c) => c.databaseName === name)!;

  it('amount es numeric(14,2) NOT NULL y string en TypeScript (RNF-19)', () => {
    const amount = column('amount');
    expect(amount.type).toBe('numeric');
    expect([amount.precision, amount.scale, amount.isNullable]).toEqual([14, 2, false]);
    expect(Reflect.getMetadata('design:type', CostEntity.prototype, 'amount')).toBe(String);
  });

  it('cost_date es DATE y string (la fecha funcional nunca es un Date)', () => {
    expect(column('cost_date').type).toBe('date');
    expect(Reflect.getMetadata('design:type', CostEntity.prototype, 'costDate')).toBe(String);
  });

  it('currency es varchar(3) NOT NULL; description es text NOT NULL', () => {
    expect([column('currency').type, column('currency').length, column('currency').isNullable]).toEqual(['varchar', '3', false]);
    expect([column('description').type, column('description').isNullable]).toEqual(['text', false]);
  });

  it('task_id es nullable; project_id, cost_category_id y created_by no', () => {
    expect(column('task_id').isNullable).toBe(true);
    for (const name of ['project_id', 'cost_category_id', 'created_by']) expect(column(name).isNullable).toBe(false);
  });

  it('revision es integer NOT NULL con default 1, y number en TypeScript', () => {
    const revision = column('revision');
    expect([revision.type, revision.isNullable, revision.default]).toEqual(['integer', false, 1]);
    expect(Reflect.getMetadata('design:type', CostEntity.prototype, 'revision')).toBe(Number);
    expect(revision.isVersion).toBe(false); // columna normal: el servicio la incrementa explícitamente
  });

  it('NO tiene budget_id: el costo no se acopla a una versión del presupuesto', () => {
    expect(meta.columns.map((c) => c.databaseName)).not.toContain('budget_id');
  });

  it('soft delete: deleted_at es DeleteDateColumn nullable; hay created_at y updated_at', () => {
    expect(column('deleted_at').isDeleteDate).toBe(true);
    expect(column('deleted_at').isNullable).toBe(true);
    expect(column('created_at').isCreateDate).toBe(true);
    expect(column('updated_at').isUpdateDate).toBe(true);
  });

  it('declara los tres CHECK (si falta alguno, schema:log propone borrarlo)', () => {
    expect(Object.fromEntries(meta.checks.map((c) => [c.name, c.expression]))).toEqual({
      ck_costs_amount_non_negative: '"amount" >= 0',
      ck_costs_currency_iso_format: `"currency" ~ '^[A-Z]{3}$'`,
      ck_costs_description_not_blank: 'length(btrim("description")) > 0',
      ck_costs_revision_positive: '"revision" >= 1',
    });
  });

  it('las FK tienen los nombres de la base y las reglas de borrado esperadas', () => {
    const byColumn = Object.fromEntries(meta.foreignKeys.map((fk) => [fk.columnNames[0], [fk.name, fk.onDelete, fk.referencedTablePath]]));
    expect(byColumn).toEqual({
      project_id: ['fk_costs_project', 'CASCADE', 'projects'],
      task_id: ['fk_costs_task', 'SET NULL', 'tasks'],
      cost_category_id: ['fk_costs_category', 'RESTRICT', 'cost_categories'],
      created_by: ['fk_costs_created_by', 'RESTRICT', 'users'],
    });
  });

  it('índice ix_costs_project_id', () => {
    expect(meta.indices.map((i) => i.name)).toContain('ix_costs_project_id');
  });
});
