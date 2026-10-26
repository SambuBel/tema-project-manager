import { MigrationInterface, QueryRunner } from 'typeorm';

const INITIAL_CATEGORIES = [
  'Recursos humanos',
  'Licencias y software',
  'Servicios de terceros',
  'Viáticos y traslados',
  'Otros',
];

/**
 * PRES-04: partidas por rubro.
 *  1. Los cinco rubros iniciales pasan a estar garantizados por migración (antes dependían de `pnpm seed`).
 *     Segura donde el seed ya corrió: no pisa ni duplica nada (se compara sin distinguir mayúsculas) y no asume tabla vacía.
 *  2. Unicidad de rubros sin distinguir mayúsculas: UNIQUE INDEX sobre lower(name). Si ya hay duplicados ("Otros" y
 *     "otros") la migración FALLA a propósito, listándolos: no se fusionan rubros en silencio. El UNIQUE(name) existente se conserva.
 *  3. `budget_items` es inmutable: un trigger rechaza todo UPDATE. No afecta INSERT ni el DELETE en cascada que provoca
 *     la eliminación física de un presupuesto (un DELETE no dispara un trigger BEFORE UPDATE).
 * Las filas de `cost_categories` y `budget_items` existentes no se modifican.
 */
export class HardenCostCategoriesAndBudgetItems1792100000000 implements MigrationInterface {
  name = 'HardenCostCategoriesAndBudgetItems1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates: Array<{ key: string; names: string }> = await queryRunner.query(
      `SELECT lower(name) AS key, string_agg('"' || name || '"', ', ') AS names FROM cost_categories GROUP BY lower(name) HAVING count(*) > 1`,
    );
    if (duplicates.length > 0) {
      throw new Error(
        `No se puede crear la unicidad de rubros sin distinguir mayúsculas: hay duplicados (${duplicates
          .map((d) => d.names)
          .join(' | ')}). Corregirlos a mano (los rubros usados en presupuestos o costos no se pueden fusionar sin revisar) y reintentar.`,
      );
    }

    await queryRunner.query(`CREATE UNIQUE INDEX "ux_cost_categories_name_lower" ON "cost_categories" (lower("name"))`);

    for (const name of INITIAL_CATEGORIES) {
      await queryRunner.query(
        `INSERT INTO "cost_categories" ("name") SELECT $1::varchar WHERE NOT EXISTS (SELECT 1 FROM "cost_categories" WHERE lower("name") = lower($1::varchar))`,
        [name],
      );
    }

    await queryRunner.query(`
      CREATE FUNCTION "fn_budget_items_forbid_update"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'budget_items es inmutable: un cambio económico se registra como una nueva versión del presupuesto con partidas nuevas'
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `CREATE TRIGGER "tr_budget_items_forbid_update" BEFORE UPDATE ON "budget_items" FOR EACH ROW EXECUTE FUNCTION "fn_budget_items_forbid_update"()`,
    );
  }

  /** Quita el trigger y el índice. Los rubros insertados NO se borran (pueden estar en uso). */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "tr_budget_items_forbid_update" ON "budget_items"`);
    await queryRunner.query(`DROP FUNCTION "fn_budget_items_forbid_update"()`);
    await queryRunner.query(`DROP INDEX "ux_cost_categories_name_lower"`);
  }
}
