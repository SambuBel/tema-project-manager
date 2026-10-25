import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RES-01: catálogo de perfiles de recurso (RF-CT-05). Solo toca `resource_profiles` y el enum del tipo de entidad de auditoría.
 *  - normaliza `name` (trim) y `currency` (trim + mayúsculas);
 *  - CHECK de nombre no vacío y de formato de moneda; `revision` (token de concurrencia, RNF-20) con su CHECK;
 *  - unicidad (lower(name), currency): el mismo nombre puede existir en monedas distintas (interpretación pendiente de TEMA);
 *  - agrega RESOURCE_PROFILE a audit_entity_type_enum.
 * El CHECK `hourly_cost >= 0` YA existía: solo faltaba declararlo en la entidad.
 *
 * Con datos previos (la base de desarrollo tiene 0 filas): NO se inventa ni se fusiona nada. Si hay un nombre vacío, una moneda
 * que tras normalizar no tiene 3 letras, o dos perfiles que colisionan en (lower(name), currency), la migración FALLA listando
 * los ids y se revierte COMPLETA (incluida la normalización).
 */
export class HardenResourceProfiles1792400000000 implements MigrationInterface {
  name = 'HardenResourceProfiles1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const blankNames: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM "resource_profiles" WHERE btrim("name") = '' ORDER BY id LIMIT 20`,
    );
    if (blankNames.length > 0) {
      throw new Error(
        `No se puede exigir nombre en resource_profiles: hay perfiles con nombre vacío (ids: ${blankNames.map((r) => r.id).join(', ')}). Corregirlos a mano y reintentar.`,
      );
    }

    await queryRunner.query(`UPDATE "resource_profiles" SET "name" = btrim("name"), "currency" = upper(btrim("currency"))`);

    const badCurrencies: Array<{ id: string; currency: string }> = await queryRunner.query(
      `SELECT id, "currency" FROM "resource_profiles" WHERE "currency" !~ '^[A-Z]{3}$' ORDER BY id LIMIT 20`,
    );
    if (badCurrencies.length > 0) {
      throw new Error(
        `No se puede exigir formato de moneda en resource_profiles: hay monedas irrecuperables (${badCurrencies
          .map((r) => `${r.id}: "${r.currency}"`)
          .join(', ')}). Corregirlas a mano (no se adivinan) y reintentar.`,
      );
    }

    const duplicates: Array<{ name: string; currency: string; ids: string }> = await queryRunner.query(
      `SELECT min("name") AS name, "currency", string_agg(id::text, ', ' ORDER BY id) AS ids
         FROM "resource_profiles" GROUP BY lower("name"), "currency" HAVING count(*) > 1`,
    );
    if (duplicates.length > 0) {
      throw new Error(
        `No se puede crear la unicidad (lower(name), currency) en resource_profiles: hay perfiles repetidos (${duplicates
          .map((d) => `"${d.name}" / ${d.currency}: ${d.ids}`)
          .join(' | ')}). Resolverlos a mano (no se fusionan) y reintentar.`,
      );
    }

    await queryRunner.query(`ALTER TABLE "resource_profiles" ADD CONSTRAINT "ck_resource_profiles_name_not_blank" CHECK (length(btrim("name")) > 0)`);
    await queryRunner.query(
      `ALTER TABLE "resource_profiles" ADD CONSTRAINT "ck_resource_profiles_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$')`,
    );
    await queryRunner.query(`ALTER TABLE "resource_profiles" ADD "revision" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "resource_profiles" ADD CONSTRAINT "ck_resource_profiles_revision_positive" CHECK ("revision" >= 1)`);
    await queryRunner.query(`CREATE UNIQUE INDEX "ux_resource_profiles_name_currency" ON "resource_profiles" (lower("name"), "currency")`);

    await queryRunner.query(`ALTER TYPE "public"."audit_entity_type_enum" ADD VALUE IF NOT EXISTS 'RESOURCE_PROFILE'`);
  }

  /**
   * Revierte los constraints, `revision` y el índice. El valor RESOURCE_PROFILE del enum de auditoría NO se quita: PostgreSQL
   * no permite borrar un valor de un enum y recrear el tipo no vale la pena (queda sin uso). La normalización de datos
   * tampoco se deshace.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."ux_resource_profiles_name_currency"`);
    await queryRunner.query(`ALTER TABLE "resource_profiles" DROP CONSTRAINT "ck_resource_profiles_revision_positive"`);
    await queryRunner.query(`ALTER TABLE "resource_profiles" DROP COLUMN "revision"`);
    await queryRunner.query(`ALTER TABLE "resource_profiles" DROP CONSTRAINT "ck_resource_profiles_currency_iso_format"`);
    await queryRunner.query(`ALTER TABLE "resource_profiles" DROP CONSTRAINT "ck_resource_profiles_name_not_blank"`);
  }
}
