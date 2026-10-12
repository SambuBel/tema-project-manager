import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSlugToProjects1791500000000 implements MigrationInterface {
  name = 'AddSlugToProjects1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Agregar columna slug nullable
    await queryRunner.query(`ALTER TABLE "projects" ADD COLUMN "slug" character varying(255)`);

    // 2. Obtener proyectos existentes ordenados por fecha de creación para asignar slugs
    const projects: Array<{ id: string; name: string }> = await queryRunner.query(
      `SELECT "id", "name" FROM "projects" ORDER BY "created_at" ASC`,
    );

    const slugify = (text: string): string => {
      const normalized = (text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      return normalized || 'proyecto';
    };

    const occupied = new Set<string>();

    for (const project of projects) {
      const base = slugify(project.name);
      let chosenSlug = base;
      let suffix = 2;
      while (occupied.has(chosenSlug)) {
        chosenSlug = `${base}-${suffix}`;
        suffix++;
      }
      occupied.add(chosenSlug);

      await queryRunner.query(`UPDATE "projects" SET "slug" = $1 WHERE "id" = $2`, [chosenSlug, project.id]);
    }

    // 3. Forzar NOT NULL y crear índice único
    await queryRunner.query(`ALTER TABLE "projects" ALTER COLUMN "slug" SET NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_projects_slug" ON "projects" ("slug")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_projects_slug"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "slug"`);
  }
}
