import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTaskSlugHistories1791800000000 implements MigrationInterface {
  name = 'CreateTaskSlugHistories1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "task_slug_histories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "task_id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "slug" character varying(255) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_task_slug_histories" PRIMARY KEY ("id"),
        CONSTRAINT "fk_task_slug_histories_task" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_task_slug_histories_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_task_slug_histories_project_slug" UNIQUE ("project_id", "slug")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_task_slug_histories_task_id" ON "task_slug_histories" ("task_id");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_task_slug_histories_project_id" ON "task_slug_histories" ("project_id");
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION check_task_slug_cross_uniqueness()
      RETURNS TRIGGER AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM task_slug_histories
          WHERE project_id = NEW.project_id AND slug = NEW.slug AND task_id != NEW.id
        ) THEN
          RAISE EXCEPTION 'El slug % ya se encuentra reservado en el histórico de otra tarea del proyecto', NEW.slug;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_tasks_slug_cross_check
      BEFORE INSERT OR UPDATE OF slug ON tasks
      FOR EACH ROW
      EXECUTE FUNCTION check_task_slug_cross_uniqueness();
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION check_task_history_slug_cross_uniqueness()
      RETURNS TRIGGER AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM tasks
          WHERE project_id = NEW.project_id AND slug = NEW.slug AND id != NEW.task_id
        ) THEN
          RAISE EXCEPTION 'El slug % ya se encuentra activo en otra tarea del proyecto', NEW.slug;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_task_history_slug_cross_check
      BEFORE INSERT OR UPDATE OF slug ON task_slug_histories
      FOR EACH ROW
      EXECUTE FUNCTION check_task_history_slug_cross_uniqueness();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_task_history_slug_cross_check ON task_slug_histories;`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS check_task_history_slug_cross_uniqueness();`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_tasks_slug_cross_check ON tasks;`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS check_task_slug_cross_uniqueness();`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_slug_histories";`);
  }
}
