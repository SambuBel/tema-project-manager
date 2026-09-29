import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cierra project_members.project_role a un catalogo fijo: hasta ahora era
 * varchar(100) libre. Pasa a ser un ENUM nativo de Postgres con solo dos valores:
 *
 *   COLLABORATOR | OBSERVER
 *
 * A propósito NO incluye PROJECT_LEADER: el líder de un proyecto sigue siendo
 * únicamente project.leaderId (ver ProjectEntity) — nunca una fila de
 * project_members. Esto hace estructuralmente imposible que project_members
 * vuelva a ser una segunda fuente de verdad del líder.
 *
 * Verificado antes de escribir esta migración (2026-09-22, contra la base local
 * tema_project_manager): `SELECT project_role, count(*) FROM project_members
 * GROUP BY project_role` devolvió 0 filas. No hay datos existentes que migrar ni
 * valores incompatibles que mapear.
 */
export class RestrictProjectMemberRole1790128020459 implements MigrationInterface {
  name = 'RestrictProjectMemberRole1790128020459';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "project_member_role_enum" AS ENUM ('COLLABORATOR', 'OBSERVER')`);
    await queryRunner.query(
      `ALTER TABLE "project_members" ALTER COLUMN "project_role" TYPE "project_member_role_enum" ` +
        `USING "project_role"::"project_member_role_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "project_members" ALTER COLUMN "project_role" TYPE varchar(100)`);
    await queryRunner.query(`DROP TYPE "project_member_role_enum"`);
  }
}
