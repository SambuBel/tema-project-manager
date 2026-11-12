import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega `projects.idempotency_key` (nullable) + índice único parcial por `(created_by, idempotency_key)`
 * para evitar proyectos duplicados ante doble envío o reintentos de red con la misma clave.
 */
export class AddIdempotencyKeyToProjects1793100000000 implements MigrationInterface {
  name = 'AddIdempotencyKeyToProjects1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" ADD "idempotency_key" character varying(100)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_projects_created_by_idempotency_key" ON "projects" ("created_by", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_projects_created_by_idempotency_key"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "idempotency_key"`);
  }
}
