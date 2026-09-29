import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PATCH /projects/:id/leader (cambio de líder) se audita reusando el subsistema de
 * actividad de proyecto que ya existe (project_activities / ProjectActivityService),
 * en vez de crear uno nuevo. Solo hace falta un valor más en el enum de acciones.
 */
export class AddLeaderChangedActivityAction1790638235056 implements MigrationInterface {
  name = 'AddLeaderChangedActivityAction1790638235056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."project_activity_action_enum" ADD VALUE IF NOT EXISTS 'PROJECT_LEADER_CHANGED'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres no soporta quitar un valor de un enum sin recrear el tipo; no hay
    // necesidad práctica de revertir esto (mismo criterio que ProjectSoftDelete
    // con PROJECT_DELETED).
    throw new Error('No se puede revertir: Postgres no permite eliminar un valor de un ENUM existente.');
  }
}
