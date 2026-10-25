import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { BudgetItemEntity } from './budget-item.entity';
import { CostCategoryEntity } from './cost-category.entity';

/**
 * Mapeo de BudgetItemEntity / CostCategoryEntity SIN conectarse a la base: lo declarado acá tiene que coincidir con
 * PostgreSQL o `schema:log` propone borrarlo (CHECK de importes) o renombrarlo (FK). La verificación contra Postgres real
 * está en budget-items.constraints.db-spec.ts.
 */
describe('BudgetItemEntity / CostCategoryEntity - metadata', () => {
  const ds = new DataSource({ type: 'postgres', entities: [__dirname + '/../../**/*.entity.ts'] });
  let items: ReturnType<DataSource['getMetadata']>;
  let categories: ReturnType<DataSource['getMetadata']>;

  beforeAll(async () => {
    await (ds as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
    items = ds.getMetadata(BudgetItemEntity);
    categories = ds.getMetadata(CostCategoryEntity);
  });

  it('amount es numeric(14,2) NOT NULL y string en TypeScript (RNF-19)', () => {
    const amount = items.columns.find((c) => c.databaseName === 'amount')!;
    expect(amount.type).toBe('numeric');
    expect([amount.precision, amount.scale, amount.isNullable]).toEqual([14, 2, false]);
    expect(Reflect.getMetadata('design:type', BudgetItemEntity.prototype, 'amount')).toBe(String);
  });

  it('NO tiene moneda propia ni updated_at: hereda la moneda del presupuesto y es inmutable', () => {
    expect(items.columns.map((c) => c.databaseName).sort()).toEqual(['amount', 'budget_id', 'cost_category_id', 'created_at', 'id']);
  });

  it('declara el CHECK de importe no negativo (si falta, schema:log propone borrarlo)', () => {
    expect(items.checks.map((c) => [c.name, c.expression])).toEqual([['ck_budget_items_amount_non_negative', '"amount" >= 0']]);
  });

  it('las FK tienen los nombres de la base y las reglas de borrado esperadas', () => {
    const byColumn = Object.fromEntries(items.foreignKeys.map((fk) => [fk.columnNames[0], [fk.name, fk.onDelete, fk.referencedTablePath]]));
    expect(byColumn).toEqual({
      budget_id: ['fk_budget_items_budget', 'CASCADE', 'budgets'],
      cost_category_id: ['fk_budget_items_category', 'RESTRICT', 'cost_categories'],
    });
  });

  it('UNIQUE(budget_id, cost_category_id)', () => {
    const unique = items.indices.find((i) => i.name === 'ux_budget_items_budget_category')!;
    expect(unique.isUnique).toBe(true);
    expect(unique.columns.map((c) => c.databaseName)).toEqual(['budget_id', 'cost_category_id']);
  });

  it('cost_categories: name único (case-sensitive) y active; el índice lower(name) está registrado SIN sincronizar', () => {
    const name = categories.columns.find((c) => c.databaseName === 'name')!;
    expect([name.type, name.length]).toEqual(['varchar', '150']);
    const lower = categories.indices.find((i) => i.name === 'ux_cost_categories_name_lower')!;
    expect(lower).toBeDefined();
    expect(lower.synchronize).toBe(false); // TypeORM no maneja índices de expresión: ni lo crea ni lo borra
    expect(categories.columns.find((c) => c.databaseName === 'active')!.default).toBe(true);
  });
});
