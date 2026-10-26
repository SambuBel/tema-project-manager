import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HU39 / RF-IA-09: los cambios hechos desde el asistente de IA tienen que poder distinguirse
 * en el historial. Reusa el tipo audit_origin_enum que ya existe (UI | AI | SYSTEM); los
 * eventos anteriores quedan como UI.
 */
export class AddOriginToProjectActivities1791900000000 implements MigrationInterface {
  name = 'AddOriginToProjectActivities1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_activities" ADD COLUMN "origin" "audit_origin_enum" NOT NULL DEFAULT 'UI'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "project_activities" DROP COLUMN "origin"`);
  }
}
