import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNameToProjectInvitations1791415772091 implements MigrationInterface {
    name = 'AddNameToProjectInvitations1791415772091'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project_invitations" ADD "name" character varying(255)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project_invitations" DROP COLUMN "name"`);
    }

}
