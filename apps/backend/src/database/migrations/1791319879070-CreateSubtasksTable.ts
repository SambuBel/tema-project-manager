import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSubtasksTable1791000000000 implements MigrationInterface {
  name = 'CreateSubtasksTable1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "subtasks" (
        "id"             uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "task_id"        uuid         NOT NULL,
        "title"          varchar(200) NOT NULL,
        "assigned_to_id" uuid,
        "completed"      boolean      NOT NULL DEFAULT false,
        "created_at"     timestamptz  NOT NULL DEFAULT now(),
        "updated_at"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subtasks"      PRIMARY KEY ("id"),
        CONSTRAINT "FK_subtasks_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_subtasks_user" FOREIGN KEY ("assigned_to_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_subtasks_task_id" ON "subtasks" ("task_id")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "subtasks"`);
  }
}