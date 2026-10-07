import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProjectInvitations1790886507565 implements MigrationInterface {
    name = 'AddProjectInvitations1790886507565'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Solo creamos la tabla project_invitations. Todo el resto de drops/alters
        // fueron autogenerados incorrectamente por TypeORM debido a desincronizaciones locales.
        await queryRunner.query(`CREATE TABLE "project_invitations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "project_id" uuid NOT NULL, "email" character varying(255) NOT NULL, "project_role" "public"."project_member_role_enum" NOT NULL, "token" character varying(255) NOT NULL, "invited_by" uuid NOT NULL, "status" character varying(50) NOT NULL DEFAULT 'PENDING', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_9ab1815332452b1459164233468" UNIQUE ("token"), CONSTRAINT "PK_bddf504e527c1c64289e2c9cfd8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "project_invitations" ADD CONSTRAINT "FK_ff93e974f241ea13e6f7d5aa2d5" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "project_invitations" ADD CONSTRAINT "FK_1ad3a7cab9985a9974194a4cbba" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project_invitations" DROP CONSTRAINT "FK_1ad3a7cab9985a9974194a4cbba"`);
        await queryRunner.query(`ALTER TABLE "project_invitations" DROP CONSTRAINT "FK_ff93e974f241ea13e6f7d5aa2d5"`);
        await queryRunner.query(`DROP TABLE "project_invitations"`);
    }
}
