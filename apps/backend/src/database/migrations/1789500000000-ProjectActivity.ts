import { MigrationInterface, QueryRunner } from "typeorm";

export class ProjectActivity1789500000000 implements MigrationInterface {
    name = 'ProjectActivity1789500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TYPE "public"."project_activity_action_enum" AS ENUM(
                'PROJECT_CREATED', 
                'PROJECT_UPDATED', 
                'PROJECT_ARCHIVED', 
                'MEMBER_ADDED', 
                'MEMBER_ROLE_CHANGED', 
                'MEMBER_REMOVED', 
                'TASK_CREATED', 
                'TASK_UPDATED', 
                'TASK_DELETED'
            )
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."project_activity_entity_type_enum" AS ENUM(
                'PROJECT', 
                'MEMBER', 
                'TASK'
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "project_activities" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "project_id" uuid NOT NULL,
                "actor_id" uuid NOT NULL,
                "action_type" "public"."project_activity_action_enum" NOT NULL,
                "entity_type" "public"."project_activity_entity_type_enum" NOT NULL,
                "entity_id" uuid,
                "metadata" jsonb,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_project_activities" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "ix_project_activities_project_id" ON "project_activities" ("project_id") `);
        await queryRunner.query(`
            ALTER TABLE "project_activities" 
            ADD CONSTRAINT "FK_project_activities_project_id" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "project_activities" 
            ADD CONSTRAINT "FK_project_activities_actor_id" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project_activities" DROP CONSTRAINT "FK_project_activities_actor_id"`);
        await queryRunner.query(`ALTER TABLE "project_activities" DROP CONSTRAINT "FK_project_activities_project_id"`);
        await queryRunner.query(`DROP INDEX "public"."ix_project_activities_project_id"`);
        await queryRunner.query(`DROP TABLE "project_activities"`);
        await queryRunner.query(`DROP TYPE "public"."project_activity_entity_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."project_activity_action_enum"`);
    }
}
