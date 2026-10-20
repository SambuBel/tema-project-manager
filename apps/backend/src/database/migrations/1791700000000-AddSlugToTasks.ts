import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSlugToTasks1791700000000 implements MigrationInterface {
  name = 'AddSlugToTasks1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Agregar columna slug nullable
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN "slug" character varying(255)`);

    // 2. Obtener tareas existentes ordenadas por project_id y created_at para asignar slugs
    const tasks: Array<{ id: string; project_id: string; title: string }> = await queryRunner.query(
      `SELECT "id", "project_id", "title" FROM "tasks" ORDER BY "project_id", "created_at" ASC`,
    );

    const slugify = (text: string): string => {
      const normalized = (text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      return normalized || 'tarea';
    };

    const occupiedPerProject = new Map<string, Set<string>>();

    for (const task of tasks) {
      if (!occupiedPerProject.has(task.project_id)) {
        occupiedPerProject.set(task.project_id, new Set<string>());
      }
      const occupied = occupiedPerProject.get(task.project_id)!;

      const base = slugify(task.title);
      let chosenSlug = base;
      let suffix = 2;
      while (occupied.has(chosenSlug)) {
        chosenSlug = `${base}-${suffix}`;
        suffix++;
      }
      occupied.add(chosenSlug);

      await queryRunner.query(`UPDATE "tasks" SET "slug" = $1 WHERE "id" = $2`, [chosenSlug, task.id]);
    }

    // 3. Forzar NOT NULL y crear índice único por proyecto
    await queryRunner.query(`ALTER TABLE "tasks" ALTER COLUMN "slug" SET NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_tasks_project_slug" ON "tasks" ("project_id", "slug")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_tasks_project_slug"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "slug"`);
  }
}
