import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PRES-01: presupuesto versionado (RN-18). Solo toca `budgets`.
 *  - `approved_at timestamptz NULL`  →  `approval_date date NOT NULL` (la fecha de aprobación es un día, no un instante;
 *    y no hay borradores: todo presupuesto registrado está aprobado).
 *  - agrega `superseded_at` (cuándo dejó de ser vigente una versión).
 *  - agrega los CHECK que faltaban: formato de moneda y "una versión vigente no está superada".
 * Los índices (UNIQUE project/version, parcial "una vigente por proyecto") y los CHECK existentes NO se tocan.
 *
 * Con datos previos (la base de desarrollo tiene 0 filas, otros entornos podrían tener):
 *  - approval_date = día de approved_at en hora de Argentina; si approved_at era NULL, el día de created_at.
 *  - la moneda se normaliza (trim + mayúsculas) antes del CHECK. Si aun así alguna no tiene 3 letras la migración
 *    FALLA a propósito (no se adivinan monedas) y hay que corregirla a mano.
 *  - superseded_at queda NULL en las versiones viejas (no hay forma de saber cuándo dejaron de regir).
 */
export class HardenBudgetsForVersioning1791700000000 implements MigrationInterface {
  name = 'HardenBudgetsForVersioning1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "budgets" ADD "approval_date" date`);
    await queryRunner.query(
      `UPDATE "budgets" SET "approval_date" = (COALESCE("approved_at", "created_at") AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`,
    );
    await queryRunner.query(`ALTER TABLE "budgets" ALTER COLUMN "approval_date" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "budgets" DROP COLUMN "approved_at"`);

    await queryRunner.query(`ALTER TABLE "budgets" ADD "superseded_at" TIMESTAMP WITH TIME ZONE`);

    await queryRunner.query(`UPDATE "budgets" SET "currency" = upper(btrim("currency"))`);
    await queryRunner.query(`ALTER TABLE "budgets" ADD CONSTRAINT "ck_budgets_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$')`);
    await queryRunner.query(
      `ALTER TABLE "budgets" ADD CONSTRAINT "ck_budgets_current_not_superseded" CHECK ((NOT "is_current") OR "superseded_at" IS NULL)`,
    );
  }

  /** Revierte la estructura. Se pierde `superseded_at` y la hora exacta de aprobación (queda a las 00:00 de Argentina). */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "budgets" DROP CONSTRAINT "ck_budgets_current_not_superseded"`);
    await queryRunner.query(`ALTER TABLE "budgets" DROP CONSTRAINT "ck_budgets_currency_iso_format"`);
    await queryRunner.query(`ALTER TABLE "budgets" DROP COLUMN "superseded_at"`);

    await queryRunner.query(`ALTER TABLE "budgets" ADD "approved_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `UPDATE "budgets" SET "approved_at" = ("approval_date"::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')`,
    );
    await queryRunner.query(`ALTER TABLE "budgets" DROP COLUMN "approval_date"`);
  }
}
