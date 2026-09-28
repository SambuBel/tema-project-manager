import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega "archivar tarea" (distinto de "borrar tarea", que ya existia via DELETE):
 * la tarea sigue existiendo, solo se marca con una fecha. No se reutiliza `deleted_at`
 * porque esa columna es semanticamente "borrado" (soft-delete real), no "archivado" —
 * mismo criterio que ya usa `projects.archived_at`.
 */
export class AddArchivedAtToTasks1790622506516 implements MigrationInterface {
  name = 'AddArchivedAtToTasks1790622506516';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN "archived_at" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "archived_at"`);
  }
}
