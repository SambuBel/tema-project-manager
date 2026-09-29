import { MigrationInterface, QueryRunner } from "typeorm";

export class IncreaseAvatarUrlLength1790202695287 implements MigrationInterface {
    name = 'IncreaseAvatarUrlLength1790202695287'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "avatar_url" TYPE character varying(2000)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // CONTRATO: No-op (Operación vacía intencional)
        // No se revierte la longitud a varchar(500) para proteger la integridad de los datos.
        // Si ejecutáramos ALTER TABLE "users" ALTER COLUMN "avatar_url" TYPE varchar(500),
        // PostgreSQL truncaría las URLs existentes (con USING SUBSTRING) perdiendo datos de forma irreversible,
        // o arrojaría un error bloqueante "value too long" interrumpiendo la migración si no se fuerza el truncado.
        // Por seguridad, el downgrade de esta migración mantiene la columna en 2000 caracteres.
    }
}
