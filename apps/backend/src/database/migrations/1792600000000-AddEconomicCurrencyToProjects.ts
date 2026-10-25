import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MONEDA ÚNICA POR PROYECTO: `projects.economic_currency` es la única fuente de verdad de la moneda de todo lo económico del
 * proyecto (presupuesto, costos y asignaciones de recursos). No hay multimoneda ni conversión dentro de un proyecto.
 *
 * Con datos previos NO se convierte ni se adivina nada. Para cada proyecto (también los dados de baja) se juntan las monedas de
 * sus presupuestos (todas las versiones), costos (también los dados de baja) y asignaciones de recursos (todas las revisiones):
 *  - una sola moneda  → es la del proyecto;
 *  - ninguna          → 'ARS' (default explícito: no hay datos que contradigan, y la moneda se puede cambiar mientras el proyecto
 *                       no tenga información económica);
 *  - más de una       → la migración FALLA listando los proyectos y sus monedas, y se revierte COMPLETA. Hay que limpiar o
 *                       recrear esos datos a mano; los importes nunca se tocan.
 * Se agrega CHECK de formato (3 letras mayúsculas). Los exchange_rates quedan fuera del flujo funcional: no se tocan.
 */
export class AddEconomicCurrencyToProjects1792600000000 implements MigrationInterface {
  name = 'AddEconomicCurrencyToProjects1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" ADD "economic_currency" character varying(3)`);

    const usage: Array<{ projectId: string; currency: string; sources: string }> = await queryRunner.query(
      `SELECT project_id AS "projectId", currency, string_agg(DISTINCT source, ', ' ORDER BY source) AS sources
         FROM (
           SELECT b.project_id, upper(btrim(b.currency)) AS currency, 'presupuesto' AS source FROM "budgets" b
           UNION ALL
           SELECT c.project_id, upper(btrim(c.currency)), 'costo' FROM "costs" c
           UNION ALL
           SELECT pm.project_id, upper(btrim(a.currency_snapshot)), 'asignación de recursos'
             FROM "project_member_allocations" a JOIN "project_members" pm ON pm.id = a.project_member_id
            WHERE a.currency_snapshot IS NOT NULL
         ) used
        GROUP BY project_id, currency
        ORDER BY project_id, currency`,
    );

    const byProject = new Map<string, Array<{ currency: string; sources: string }>>();
    for (const row of usage) byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), { currency: row.currency, sources: row.sources }]);

    const mixed = [...byProject.entries()].filter(([, currencies]) => currencies.length > 1);
    if (mixed.length > 0) {
      throw new Error(
        `No se puede definir la moneda única por proyecto: hay proyectos con monedas mezcladas (no se convierte ni se elige una). ` +
          `Corregir o recrear esos datos a mano y reintentar. Proyectos: ` +
          mixed.map(([projectId, currencies]) => `${projectId} [${currencies.map((c) => `${c.currency} (${c.sources})`).join(' | ')}]`).join('; '),
      );
    }

    for (const [projectId, currencies] of byProject) {
      await queryRunner.query(`UPDATE "projects" SET "economic_currency" = $1 WHERE "id" = $2`, [currencies[0]!.currency, projectId]);
    }
    await queryRunner.query(`UPDATE "projects" SET "economic_currency" = 'ARS' WHERE "economic_currency" IS NULL`);

    const malformed: Array<{ id: string; economic_currency: string }> = await queryRunner.query(
      `SELECT id, "economic_currency" FROM "projects" WHERE "economic_currency" !~ '^[A-Z]{3}$' ORDER BY id LIMIT 20`,
    );
    if (malformed.length > 0) {
      throw new Error(
        `Hay monedas existentes que no tienen formato de 3 letras (${malformed.map((r) => `${r.id}: "${r.economic_currency}"`).join(', ')}). Corregirlas a mano (no se adivinan) y reintentar.`,
      );
    }

    await queryRunner.query(`ALTER TABLE "projects" ALTER COLUMN "economic_currency" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "projects" ALTER COLUMN "economic_currency" SET DEFAULT 'ARS'`);
    await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "ck_projects_economic_currency_format" CHECK ("economic_currency" ~ '^[A-Z]{3}$')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "ck_projects_economic_currency_format"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "economic_currency"`);
  }
}
