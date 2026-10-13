import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Login con email + contraseña. `password_hash` es NULLABLE a propósito: los usuarios existentes
 * (que entran con Google) quedan en NULL y no pueden usar el login por contraseña hasta que un ADMIN
 * les defina una. No se toca ningún dato existente.
 */
export class AddPasswordHashToUsers1791500000000 implements MigrationInterface {
  name = 'AddPasswordHashToUsers1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "password_hash" character varying(255)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
  }
}
