import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * COST-01: endurece `costs` (RF-CT-03). Solo toca `costs`.
 *  - la moneda se normaliza (trim + mayúsculas) y se agrega el CHECK de formato `ck_costs_currency_iso_format`;
 *  - `description` pasa a NOT NULL y no vacía (`ck_costs_description_not_blank`): es obligatoria según RF-CT-03.
 * Los CHECK de importe y las FK ya existían en la base; solo faltaba declararlos en la entidad.
 *
 * Con datos previos (la base de desarrollo tiene 0 filas, otros entornos podrían tener):
 *  - NO se inventa nada: si hay una descripción NULL o vacía, o una moneda que tras normalizar no tiene 3 letras, la
 *    migración FALLA indicando los costos afectados y se revierte COMPLETA (incluida la normalización de monedas).
 */
export class HardenCostsSchema1792200000000 implements MigrationInterface {
  name = 'HardenCostsSchema1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const blankDescriptions: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM "costs" WHERE "description" IS NULL OR btrim("description") = '' ORDER BY id LIMIT 20`,
    );
    if (blankDescriptions.length > 0) {
      throw new Error(
        `No se puede exigir descripción en costs: hay costos con descripción NULL o vacía (ids: ${blankDescriptions
          .map((row) => row.id)
          .join(', ')}${blankDescriptions.length === 20 ? ', …' : ''}). Completarla a mano (no se inventa) y reintentar.`,
      );
    }

    await queryRunner.query(`UPDATE "costs" SET "currency" = upper(btrim("currency"))`);
    const badCurrencies: Array<{ id: string; currency: string }> = await queryRunner.query(
      `SELECT id, "currency" FROM "costs" WHERE "currency" !~ '^[A-Z]{3}$' ORDER BY id LIMIT 20`,
    );
    if (badCurrencies.length > 0) {
      throw new Error(
        `No se puede exigir formato de moneda en costs: hay monedas irrecuperables (${badCurrencies
          .map((row) => `${row.id}: "${row.currency}"`)
          .join(', ')}). Corregirlas a mano (no se adivinan) y reintentar.`,
      );
    }

    await queryRunner.query(`ALTER TABLE "costs" ALTER COLUMN "description" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "costs" ADD CONSTRAINT "ck_costs_description_not_blank" CHECK (length(btrim("description")) > 0)`,
    );
    await queryRunner.query(`ALTER TABLE "costs" ADD CONSTRAINT "ck_costs_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$')`);
  }

  /** Revierte las garantías. La normalización de monedas no se deshace (no hay forma de saber cómo estaban escritas). */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "costs" DROP CONSTRAINT "ck_costs_currency_iso_format"`);
    await queryRunner.query(`ALTER TABLE "costs" DROP CONSTRAINT "ck_costs_description_not_blank"`);
    await queryRunner.query(`ALTER TABLE "costs" ALTER COLUMN "description" DROP NOT NULL`);
  }
}
