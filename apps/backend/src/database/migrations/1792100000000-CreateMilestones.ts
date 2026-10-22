import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMilestones1792100000000 implements MigrationInterface {
  name = 'CreateMilestones1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Tabla milestones con restricciones de clave primaria, foráneas y check de nombre no vacío
    await queryRunner.query(`
      CREATE TABLE "milestones" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "name" character varying(200) NOT NULL,
        "description" text,
        "due_date" date NOT NULL,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "completed_by" uuid,
        "created_by" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_milestones" PRIMARY KEY ("id"),
        CONSTRAINT "fk_milestones_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_milestones_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_milestones_completed_by" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "ck_milestones_name_not_empty" CHECK (btrim("name") <> '')
      );
    `);

    // 2. Índices de consulta frecuente
    await queryRunner.query(`
      CREATE INDEX "ix_milestones_project_id" ON "milestones" ("project_id");
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_milestones_project_due_date" ON "milestones" ("project_id", "due_date");
    `);

    // 3. Unicidad de nombre por proyecto ignorando mayúsculas/minúsculas sobre registros activos (D5 + D10)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_milestones_project_name_active" ON "milestones" ("project_id", lower("name")) WHERE "deleted_at" IS NULL;
    `);

    // 4. Asociación opcional 1:N desde tasks hacia milestones (D2)
    await queryRunner.query(`
      ALTER TABLE "tasks" ADD COLUMN "milestone_id" uuid;
    `);

    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD CONSTRAINT "fk_tasks_milestone"
      FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_tasks_milestone_id" ON "tasks" ("milestone_id");
    `);

    // 5. Restricción de pertenencia al mismo proyecto y estado activo (evita asociar tareas a hitos de otros proyectos o eliminados lógicamente)
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION check_task_milestone_same_project()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.milestone_id IS NOT NULL THEN
          IF NOT EXISTS (
            SELECT 1 FROM milestones m
            WHERE m.id = NEW.milestone_id AND m.project_id = NEW.project_id AND m.deleted_at IS NULL
          ) THEN
            RAISE EXCEPTION 'La tarea y el hito deben pertenecer al mismo proyecto y el hito debe estar activo';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_tasks_milestone_same_project
      BEFORE INSERT OR UPDATE OF milestone_id, project_id ON tasks
      FOR EACH ROW
      EXECUTE FUNCTION check_task_milestone_same_project();
    `);

    // 6. Salvaguarda defensiva si se intentara cambiar el proyecto de un hito con tareas asociadas
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION check_milestone_tasks_same_project()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN
          IF EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.milestone_id = NEW.id AND t.project_id != NEW.project_id
          ) THEN
            RAISE EXCEPTION 'No se puede cambiar el proyecto del hito porque tiene tareas asociadas en otro proyecto';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_milestones_project_change
      BEFORE UPDATE OF project_id ON milestones
      FOR EACH ROW
      EXECUTE FUNCTION check_milestone_tasks_same_project();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_milestones_project_change ON "milestones";`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS check_milestone_tasks_same_project();`);

    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_tasks_milestone_same_project ON "tasks";`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS check_task_milestone_same_project();`);

    await queryRunner.query(`DROP INDEX IF EXISTS "ix_tasks_milestone_id";`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "fk_tasks_milestone";`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "milestone_id";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "uq_milestones_project_name_active";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_milestones_project_due_date";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_milestones_project_id";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "milestones";`);
  }
}
