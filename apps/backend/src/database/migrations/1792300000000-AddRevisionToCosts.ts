import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * COST-02: control de concurrencia optimista (RNF-20) de los costos. Agrega `revision`, un contador que arranca en 1 y
 * suma 1 en cada edición, bajo el lock de la fila. Es el token de concurrencia (`expectedRevision`); `updated_at` queda como
 * simple metadato temporal (no sirve de token: la base guarda microsegundos pero la API entrega milisegundos).
 * Las filas existentes quedan en revision = 1. Solo toca `costs`.
 */
export class AddRevisionToCosts1792300000000 implements MigrationInterface {
  name = 'AddRevisionToCosts1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "costs" ADD "revision" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "costs" ADD CONSTRAINT "ck_costs_revision_positive" CHECK ("revision" >= 1)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "costs" DROP CONSTRAINT "ck_costs_revision_positive"`);
    await queryRunner.query(`ALTER TABLE "costs" DROP COLUMN "revision"`);
  }
}
