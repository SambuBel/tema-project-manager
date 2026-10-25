import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RES-02: asignación versionada de perfiles de recurso (RF-CT-06 / RF-CT-07).
 *  - `project_members` queda SOLO organizativo: se eliminan `resource_profile_id` y `estimated_hours` (y su FK). RN-25 queda
 *    protegido por construcción: ninguna consulta de equipo puede filtrar información económica.
 *  - se crea `project_member_allocations`: revisiones inmutables con snapshot de perfil/tarifa/moneda, horas, costo estimado,
 *    presupuesto vigente, usuario y origen. Es la única fuente de verdad económica y el historial funcional.
 *  - los nombres de FK que `schema:log` proponía renombrar (`fk_pm_project`, `fk_pm_user`) se arreglan con decoradores.
 *
 * Con datos previos (la base de desarrollo tiene 0 filas): si algún miembro tiene perfil u horas cargados (solo posible por SQL
 * manual, ninguna API los escribía) la migración FALLA indicando los miembros y NO inventa snapshots.
 */
export class ProjectMemberAllocations1792500000000 implements MigrationInterface {
  name = 'ProjectMemberAllocations1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const withData: Array<{ id: string; project_id: string }> = await queryRunner.query(
      `SELECT id, project_id FROM "project_members" WHERE "resource_profile_id" IS NOT NULL OR "estimated_hours" IS NOT NULL ORDER BY id LIMIT 50`,
    );
    if (withData.length > 0) {
      throw new Error(
        `No se pueden eliminar resource_profile_id / estimated_hours de project_members: hay miembros con datos económicos cargados (${withData
          .map((row) => `miembro ${row.id} del proyecto ${row.project_id}`)
          .join('; ')}). No se inventan snapshots: resolvelos a mano y reintentá.`,
      );
    }

    await queryRunner.query(`ALTER TABLE "project_members" DROP CONSTRAINT "fk_pm_resource_profile"`);
    await queryRunner.query(`ALTER TABLE "project_members" DROP COLUMN "resource_profile_id"`);
    await queryRunner.query(`ALTER TABLE "project_members" DROP COLUMN "estimated_hours"`);

    await queryRunner.query(`
      CREATE TABLE "project_member_allocations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_member_id" uuid NOT NULL,
        "revision" integer NOT NULL,
        "is_current" boolean NOT NULL,
        "superseded_at" TIMESTAMP WITH TIME ZONE,
        "resource_profile_id" uuid,
        "profile_name_snapshot" character varying(150),
        "hourly_cost_snapshot" numeric(12,2),
        "currency_snapshot" character varying(3),
        "estimated_hours" numeric(8,2),
        "estimated_cost_snapshot" numeric(18,2),
        "budget_id" uuid,
        "changed_by" uuid NOT NULL,
        "origin" "public"."audit_origin_enum" NOT NULL DEFAULT 'UI',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "pk_project_member_allocations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_pm_allocations_member" FOREIGN KEY ("project_member_id") REFERENCES "project_members" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pm_allocations_profile" FOREIGN KEY ("resource_profile_id") REFERENCES "resource_profiles" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_pm_allocations_budget" FOREIGN KEY ("budget_id") REFERENCES "budgets" ("id"),
        CONSTRAINT "fk_pm_allocations_changed_by" FOREIGN KEY ("changed_by") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_pm_allocations_revision_positive" CHECK ("revision" >= 1),
        CONSTRAINT "ck_pm_allocations_current_not_superseded" CHECK ((NOT "is_current") OR "superseded_at" IS NULL),
        CONSTRAINT "ck_pm_allocations_profile_snapshot_consistent" CHECK (
          ("resource_profile_id" IS NULL AND "profile_name_snapshot" IS NULL AND "hourly_cost_snapshot" IS NULL AND "currency_snapshot" IS NULL)
          OR ("resource_profile_id" IS NOT NULL AND "profile_name_snapshot" IS NOT NULL AND "hourly_cost_snapshot" IS NOT NULL AND "currency_snapshot" IS NOT NULL)
        ),
        CONSTRAINT "ck_pm_allocations_currency_iso_format" CHECK ("currency_snapshot" ~ '^[A-Z]{3}$'),
        CONSTRAINT "ck_pm_allocations_hourly_cost_non_negative" CHECK ("hourly_cost_snapshot" >= 0),
        CONSTRAINT "ck_pm_allocations_estimated_hours_non_negative" CHECK ("estimated_hours" >= 0),
        CONSTRAINT "ck_pm_allocations_estimated_cost_non_negative" CHECK ("estimated_cost_snapshot" >= 0),
        CONSTRAINT "ck_pm_allocations_cost_presence" CHECK (("estimated_cost_snapshot" IS NULL) = ("estimated_hours" IS NULL OR "hourly_cost_snapshot" IS NULL)),
        CONSTRAINT "ck_pm_allocations_cost_matches_inputs" CHECK ("estimated_cost_snapshot" = round("estimated_hours" * "hourly_cost_snapshot", 2))
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "ux_pm_allocations_member_revision" ON "project_member_allocations" ("project_member_id", "revision")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "ux_pm_allocations_one_current" ON "project_member_allocations" ("project_member_id") WHERE "is_current" = true`);

    // Inmutabilidad: la única modificación permitida es pasar la revisión VIGENTE a histórica (is_current true → false con
    // superseded_at). Nada más cambia jamás, ni se reactiva una histórica. INSERT y DELETE (cascada) no se bloquean.
    await queryRunner.query(`
      CREATE FUNCTION "fn_pm_allocations_immutable"() RETURNS trigger AS $$
      BEGIN
        IF (NEW.id, NEW.project_member_id, NEW.revision, NEW.resource_profile_id, NEW.profile_name_snapshot, NEW.hourly_cost_snapshot,
            NEW.currency_snapshot, NEW.estimated_hours, NEW.estimated_cost_snapshot, NEW.budget_id, NEW.changed_by, NEW.origin, NEW.created_at)
           IS DISTINCT FROM
           (OLD.id, OLD.project_member_id, OLD.revision, OLD.resource_profile_id, OLD.profile_name_snapshot, OLD.hourly_cost_snapshot,
            OLD.currency_snapshot, OLD.estimated_hours, OLD.estimated_cost_snapshot, OLD.budget_id, OLD.changed_by, OLD.origin, OLD.created_at)
        THEN
          RAISE EXCEPTION 'project_member_allocations es inmutable: un cambio económico se registra como una revisión nueva'
            USING ERRCODE = 'restrict_violation';
        END IF;
        IF NOT (OLD.is_current AND NOT NEW.is_current AND NEW.superseded_at IS NOT NULL) THEN
          RAISE EXCEPTION 'project_member_allocations: solo la revisión vigente puede pasar a histórica (is_current true -> false con superseded_at)'
            USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `CREATE TRIGGER "tr_pm_allocations_immutable" BEFORE UPDATE ON "project_member_allocations" FOR EACH ROW EXECUTE FUNCTION "fn_pm_allocations_immutable"()`,
    );
  }

  /**
   * Revierte a las columnas anteriores SOLO si la tabla está vacía: nunca pierde historial en silencio (si tiene filas, falla).
   * La FK original (ON DELETE SET NULL) se recrea tal cual estaba.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const [counted]: Array<{ total: number }> = await queryRunner.query(`SELECT COUNT(*)::int AS total FROM "project_member_allocations"`);
    const total = counted!.total;
    if (total > 0) {
      throw new Error(
        `No se puede revertir: project_member_allocations tiene ${total} revisión(es) y borrarlas perdería el historial económico. Exportalas o eliminalas a mano antes.`,
      );
    }
    await queryRunner.query(`DROP TRIGGER "tr_pm_allocations_immutable" ON "project_member_allocations"`);
    await queryRunner.query(`DROP FUNCTION "fn_pm_allocations_immutable"()`);
    await queryRunner.query(`DROP TABLE "project_member_allocations"`);
    await queryRunner.query(`ALTER TABLE "project_members" ADD "resource_profile_id" uuid`);
    await queryRunner.query(`ALTER TABLE "project_members" ADD "estimated_hours" numeric(8,2)`);
    await queryRunner.query(
      `ALTER TABLE "project_members" ADD CONSTRAINT "fk_pm_resource_profile" FOREIGN KEY ("resource_profile_id") REFERENCES "resource_profiles" ("id") ON DELETE SET NULL`,
    );
  }
}
