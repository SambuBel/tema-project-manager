import { MigrationInterface, QueryRunner } from "typeorm";

export class ProjectSoftDelete1789600000000 implements MigrationInterface {
    name = 'ProjectSoftDelete1789600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Añadir baja lógica a projects
        await queryRunner.query(`ALTER TABLE "projects" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        
        // El enum 'project_activity_action_enum' necesita 'PROJECT_DELETED'
        await queryRunner.query(`ALTER TYPE "public"."project_activity_action_enum" ADD VALUE IF NOT EXISTS 'PROJECT_DELETED'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        throw new Error("No se puede hacer rollback de la baja lógica sin restaurar proyectos eliminados involuntariamente. El rollback está deshabilitado para prevenir pérdida de datos.");
    }
}
