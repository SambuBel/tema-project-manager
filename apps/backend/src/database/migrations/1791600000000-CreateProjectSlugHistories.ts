import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectSlugHistories1791600000000 implements MigrationInterface {
  name = 'CreateProjectSlugHistories1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "project_slug_histories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "slug" character varying(255) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_project_slug_histories" PRIMARY KEY ("id"),
        CONSTRAINT "fk_project_slug_histories_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_project_slug_histories_slug" UNIQUE ("slug")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_project_slug_histories_project_id" ON "project_slug_histories" ("project_id");
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION check_project_slug_cross_uniqueness()
      RETURNS TRIGGER AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM project_slug_histories
          WHERE slug = NEW.slug AND project_id != NEW.id
        ) THEN
          RAISE EXCEPTION 'El slug % ya se encuentra reservado en el histórico de otro proyecto', NEW.slug;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_projects_slug_cross_check
      BEFORE INSERT OR UPDATE OF slug ON projects
      FOR EACH ROW
      EXECUTE FUNCTION check_project_slug_cross_uniqueness();
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION check_history_slug_cross_uniqueness()
      RETURNS TRIGGER AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM projects
          WHERE slug = NEW.slug AND id != NEW.project_id
        ) THEN
          RAISE EXCEPTION 'El slug % ya se encuentra activo en otro proyecto', NEW.slug;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_history_slug_cross_check
      BEFORE INSERT OR UPDATE OF slug ON project_slug_histories
      FOR EACH ROW
      EXECUTE FUNCTION check_history_slug_cross_uniqueness();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_history_slug_cross_check ON project_slug_histories;`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS check_history_slug_cross_uniqueness();`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_projects_slug_cross_check ON projects;`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS check_project_slug_cross_uniqueness();`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_slug_histories";`);
  }
}
