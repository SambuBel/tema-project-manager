import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema inicial de la base de datos.
 *
 * Escrita a mano (no generada con `migration:generate`) para poder controlar con precision
 * enums nativos de Postgres, el indice unico parcial de `budgets` y los CHECK constraints
 * que TypeORM no modela via decoradores. Las entidades en src/database/entities (y
 * src/projects/project.entity.ts) reflejan exactamente estas tablas.
 *
 * Nota: external_accounts (identidades OAuth) queda deliberadamente fuera de esta migration,
 * por pedido explicito, hasta que se implemente el login con Google.
 */
export class InitialSchema1789001762281 implements MigrationInterface {
  name = 'InitialSchema1789001762281';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const statements = [
      // ---------------------------------------------------------------------
      // Enums
      // ---------------------------------------------------------------------
      `CREATE TYPE "role_name_enum" AS ENUM ('ADMIN', 'PROGRAM_MANAGER', 'PROJECT_LEADER', 'COLLABORATOR', 'OBSERVER')`,
      `CREATE TYPE "project_status_enum" AS ENUM ('PLANNED', 'IN_PROGRESS', 'PAUSED', 'FINISHED', 'CANCELLED')`,
      `CREATE TYPE "task_status_enum" AS ENUM ('PENDING', 'BLOCKED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')`,
      `CREATE TYPE "task_priority_enum" AS ENUM ('LOW', 'MEDIUM', 'HIGH')`,
      `CREATE TYPE "dependency_type_enum" AS ENUM ('FINISH_START', 'START_START', 'FINISH_FINISH', 'START_FINISH')`,
      `CREATE TYPE "audit_entity_type_enum" AS ENUM ('TASK', 'PROJECT', 'BUDGET', 'COST')`,
      `CREATE TYPE "audit_origin_enum" AS ENUM ('UI', 'AI', 'SYSTEM')`,
      `CREATE TYPE "notification_channel_enum" AS ENUM ('IN_APP', 'EMAIL')`,
      `CREATE TYPE "ai_message_role_enum" AS ENUM ('USER', 'ASSISTANT', 'TOOL', 'SYSTEM')`,

      // ---------------------------------------------------------------------
      // users
      // ---------------------------------------------------------------------
      `CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL,
        "name" varchar(200) NOT NULL,
        "avatar_url" varchar(500),
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "pk_users" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX "ux_users_email" ON "users" ("email")`,

      // ---------------------------------------------------------------------
      // roles + user_roles
      // ---------------------------------------------------------------------
      `CREATE TABLE "roles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" "role_name_enum" NOT NULL,
        CONSTRAINT "pk_roles" PRIMARY KEY ("id"),
        CONSTRAINT "ux_roles_name" UNIQUE ("name")
      )`,
      `CREATE TABLE "user_roles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_roles" PRIMARY KEY ("id"),
        CONSTRAINT "fk_user_roles_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_user_roles_role" FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE
      )`,
      `CREATE UNIQUE INDEX "ux_user_roles_user_role" ON "user_roles" ("user_id", "role_id")`,

      // ---------------------------------------------------------------------
      // projects (lider y creador obligatorios: un proyecto no puede quedar sin lider)
      // ---------------------------------------------------------------------
      `CREATE TABLE "projects" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(200) NOT NULL,
        "description" text,
        "start_date" date,
        "estimated_end_date" date,
        "status" "project_status_enum" NOT NULL DEFAULT 'PLANNED',
        "leader_id" uuid NOT NULL,
        "created_by" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "archived_at" timestamptz,
        CONSTRAINT "pk_projects" PRIMARY KEY ("id"),
        CONSTRAINT "fk_projects_leader" FOREIGN KEY ("leader_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_projects_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT
      )`,
      `CREATE INDEX "ix_projects_status" ON "projects" ("status")`,

      // ---------------------------------------------------------------------
      // project_status_history
      // ---------------------------------------------------------------------
      `CREATE TABLE "project_status_history" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "previous_status" "project_status_enum",
        "new_status" "project_status_enum" NOT NULL,
        "changed_by_user_id" uuid NOT NULL,
        "changed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_project_status_history" PRIMARY KEY ("id"),
        CONSTRAINT "fk_psh_project" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_psh_changed_by" FOREIGN KEY ("changed_by_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT
      )`,
      `CREATE INDEX "ix_project_status_history_project_id" ON "project_status_history" ("project_id")`,

      // ---------------------------------------------------------------------
      // resource_profiles
      // ---------------------------------------------------------------------
      `CREATE TABLE "resource_profiles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(150) NOT NULL,
        "hourly_cost" numeric(12,2) NOT NULL,
        "currency" varchar(3) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_resource_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "ck_resource_profiles_hourly_cost_non_negative" CHECK ("hourly_cost" >= 0)
      )`,

      // ---------------------------------------------------------------------
      // project_members
      // ---------------------------------------------------------------------
      `CREATE TABLE "project_members" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "project_role" varchar(100) NOT NULL,
        "resource_profile_id" uuid,
        "estimated_hours" numeric(8,2),
        "joined_at" timestamptz NOT NULL DEFAULT now(),
        "removed_at" timestamptz,
        CONSTRAINT "pk_project_members" PRIMARY KEY ("id"),
        CONSTRAINT "fk_pm_project" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pm_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_pm_resource_profile" FOREIGN KEY ("resource_profile_id") REFERENCES "resource_profiles" ("id") ON DELETE SET NULL
      )`,
      `CREATE UNIQUE INDEX "ux_project_members_project_user" ON "project_members" ("project_id", "user_id")`,
      `CREATE INDEX "ix_project_members_project_id" ON "project_members" ("project_id")`,

      // ---------------------------------------------------------------------
      // tasks (jerarquia via parent_task_id; deteccion de ciclos queda para el backend)
      // ---------------------------------------------------------------------
      `CREATE TABLE "tasks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "parent_task_id" uuid,
        "title" varchar(300) NOT NULL,
        "description" text,
        "responsible_user_id" uuid,
        "status" "task_status_enum" NOT NULL DEFAULT 'PENDING',
        "priority" "task_priority_enum" NOT NULL DEFAULT 'MEDIUM',
        "planned_start_date" date,
        "due_date" date,
        "estimated_cost" numeric(14,2),
        "actual_cost" numeric(14,2),
        "created_by" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "pk_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "fk_tasks_project" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_tasks_parent_task" FOREIGN KEY ("parent_task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_tasks_responsible_user" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_tasks_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_tasks_estimated_cost_non_negative" CHECK ("estimated_cost" IS NULL OR "estimated_cost" >= 0),
        CONSTRAINT "ck_tasks_actual_cost_non_negative" CHECK ("actual_cost" IS NULL OR "actual_cost" >= 0)
      )`,
      `CREATE INDEX "ix_tasks_project_id" ON "tasks" ("project_id")`,
      `CREATE INDEX "ix_tasks_responsible_user_id" ON "tasks" ("responsible_user_id")`,
      `CREATE INDEX "ix_tasks_status" ON "tasks" ("status")`,
      `CREATE INDEX "ix_tasks_due_date" ON "tasks" ("due_date")`,
      `CREATE INDEX "ix_tasks_parent_task_id" ON "tasks" ("parent_task_id")`,

      // ---------------------------------------------------------------------
      // task_dependencies
      // ---------------------------------------------------------------------
      `CREATE TABLE "task_dependencies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "predecessor_task_id" uuid NOT NULL,
        "successor_task_id" uuid NOT NULL,
        "dependency_type" "dependency_type_enum" NOT NULL DEFAULT 'FINISH_START',
        "created_by" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_task_dependencies" PRIMARY KEY ("id"),
        CONSTRAINT "fk_td_predecessor" FOREIGN KEY ("predecessor_task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_td_successor" FOREIGN KEY ("successor_task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_td_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_task_dependencies_no_self_reference" CHECK ("predecessor_task_id" <> "successor_task_id")
      )`,
      `CREATE UNIQUE INDEX "ux_task_dependencies_unique" ON "task_dependencies" ("predecessor_task_id", "successor_task_id", "dependency_type")`,

      // ---------------------------------------------------------------------
      // tags + task_tags
      // ---------------------------------------------------------------------
      `CREATE TABLE "tags" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "name" varchar(100) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tags" PRIMARY KEY ("id"),
        CONSTRAINT "fk_tags_project" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE
      )`,
      `CREATE UNIQUE INDEX "ux_tags_project_name" ON "tags" ("project_id", "name")`,
      `CREATE TABLE "task_tags" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "task_id" uuid NOT NULL,
        "tag_id" uuid NOT NULL,
        CONSTRAINT "pk_task_tags" PRIMARY KEY ("id"),
        CONSTRAINT "fk_task_tags_task" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_task_tags_tag" FOREIGN KEY ("tag_id") REFERENCES "tags" ("id") ON DELETE CASCADE
      )`,
      `CREATE UNIQUE INDEX "ux_task_tags_task_tag" ON "task_tags" ("task_id", "tag_id")`,

      // ---------------------------------------------------------------------
      // comments
      // ---------------------------------------------------------------------
      `CREATE TABLE "comments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "task_id" uuid NOT NULL,
        "author_user_id" uuid NOT NULL,
        "content" text NOT NULL,
        "edited_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "pk_comments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_comments_task" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_comments_author" FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT
      )`,
      `CREATE INDEX "ix_comments_task_id" ON "comments" ("task_id")`,

      // ---------------------------------------------------------------------
      // cost_categories (necesaria antes de budgets/costs)
      // ---------------------------------------------------------------------
      `CREATE TABLE "cost_categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(150) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_cost_categories" PRIMARY KEY ("id"),
        CONSTRAINT "ux_cost_categories_name" UNIQUE ("name")
      )`,

      // ---------------------------------------------------------------------
      // budgets + budget_items
      // ---------------------------------------------------------------------
      `CREATE TABLE "budgets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "total_amount" numeric(14,2) NOT NULL,
        "currency" varchar(3) NOT NULL,
        "version" integer NOT NULL,
        "approved_at" timestamptz,
        "created_by" uuid NOT NULL,
        "is_current" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_budgets" PRIMARY KEY ("id"),
        CONSTRAINT "fk_budgets_project" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_budgets_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_budgets_total_amount_non_negative" CHECK ("total_amount" >= 0),
        CONSTRAINT "ck_budgets_version_positive" CHECK ("version" > 0)
      )`,
      `CREATE UNIQUE INDEX "ux_budgets_project_version" ON "budgets" ("project_id", "version")`,
      // Como maximo un presupuesto vigente por proyecto: indice unico PARCIAL
      // (TypeORM no soporta declarar esto via decorador, por eso se crea a mano aca).
      `CREATE UNIQUE INDEX "ux_budgets_one_current_per_project" ON "budgets" ("project_id") WHERE "is_current" = true`,
      `CREATE TABLE "budget_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "budget_id" uuid NOT NULL,
        "cost_category_id" uuid NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_budget_items" PRIMARY KEY ("id"),
        CONSTRAINT "fk_budget_items_budget" FOREIGN KEY ("budget_id") REFERENCES "budgets" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_budget_items_category" FOREIGN KEY ("cost_category_id") REFERENCES "cost_categories" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_budget_items_amount_non_negative" CHECK ("amount" >= 0)
      )`,
      `CREATE UNIQUE INDEX "ux_budget_items_budget_category" ON "budget_items" ("budget_id", "cost_category_id")`,

      // ---------------------------------------------------------------------
      // costs
      // ---------------------------------------------------------------------
      `CREATE TABLE "costs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "task_id" uuid,
        "cost_category_id" uuid NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "currency" varchar(3) NOT NULL,
        "cost_date" date NOT NULL,
        "description" text,
        "created_by" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "pk_costs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_costs_project" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_costs_task" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_costs_category" FOREIGN KEY ("cost_category_id") REFERENCES "cost_categories" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_costs_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_costs_amount_non_negative" CHECK ("amount" >= 0)
      )`,
      `CREATE INDEX "ix_costs_project_id" ON "costs" ("project_id")`,

      // ---------------------------------------------------------------------
      // attachments (exactamente uno de task_id / cost_id)
      // ---------------------------------------------------------------------
      `CREATE TABLE "attachments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "task_id" uuid,
        "cost_id" uuid,
        "file_name" varchar(300) NOT NULL,
        "storage_path" varchar(1000) NOT NULL,
        "mime_type" varchar(150) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "uploaded_by" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_attachments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_attachments_task" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_attachments_cost" FOREIGN KEY ("cost_id") REFERENCES "costs" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_attachments_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_attachments_size_non_negative" CHECK ("size_bytes" >= 0),
        CONSTRAINT "ck_attachments_exactly_one_owner" CHECK (
          (("task_id" IS NOT NULL)::int + ("cost_id" IS NOT NULL)::int) = 1
        )
      )`,

      // ---------------------------------------------------------------------
      // exchange_rates
      // ---------------------------------------------------------------------
      `CREATE TABLE "exchange_rates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "from_currency" varchar(3) NOT NULL,
        "to_currency" varchar(3) NOT NULL,
        "rate" numeric(18,6) NOT NULL,
        "effective_date" date NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_exchange_rates" PRIMARY KEY ("id"),
        CONSTRAINT "ck_exchange_rates_rate_positive" CHECK ("rate" > 0)
      )`,
      `CREATE UNIQUE INDEX "ux_exchange_rates_pair_date" ON "exchange_rates" ("from_currency", "to_currency", "effective_date")`,

      // ---------------------------------------------------------------------
      // progress_metrics
      // ---------------------------------------------------------------------
      `CREATE TABLE "progress_metrics" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "measured_at" timestamptz NOT NULL,
        "actual_progress" numeric(5,2) NOT NULL,
        "expected_progress" numeric(5,2),
        "deviation" numeric(5,2),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_progress_metrics" PRIMARY KEY ("id"),
        CONSTRAINT "fk_progress_metrics_project" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE
      )`,
      `CREATE INDEX "ix_progress_metrics_project_measured_at" ON "progress_metrics" ("project_id", "measured_at")`,

      // ---------------------------------------------------------------------
      // audit_logs (sin FK polimorfica sobre entity_id, a proposito)
      // ---------------------------------------------------------------------
      `CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "entity_type" "audit_entity_type_enum" NOT NULL,
        "entity_id" uuid NOT NULL,
        "action" varchar(50) NOT NULL,
        "user_id" uuid,
        "origin" "audit_origin_enum" NOT NULL DEFAULT 'SYSTEM',
        "old_values" jsonb,
        "new_values" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_audit_logs_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL
      )`,
      `CREATE INDEX "ix_audit_logs_entity" ON "audit_logs" ("entity_type", "entity_id")`,

      // ---------------------------------------------------------------------
      // notifications
      // ---------------------------------------------------------------------
      `CREATE TABLE "notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "project_id" uuid,
        "task_id" uuid,
        "type" varchar(50) NOT NULL,
        "channel" "notification_channel_enum" NOT NULL DEFAULT 'IN_APP',
        "title" varchar(200) NOT NULL,
        "message" text NOT NULL,
        "read_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "fk_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_notifications_project" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_notifications_task" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE
      )`,
      `CREATE INDEX "ix_notifications_user_id" ON "notifications" ("user_id")`,

      // ---------------------------------------------------------------------
      // ai_conversations + ai_messages
      // ---------------------------------------------------------------------
      `CREATE TABLE "ai_conversations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "total_input_tokens" integer NOT NULL DEFAULT 0,
        "total_output_tokens" integer NOT NULL DEFAULT 0,
        CONSTRAINT "pk_ai_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ai_conversations_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )`,
      `CREATE TABLE "ai_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "role" "ai_message_role_enum" NOT NULL,
        "content" text NOT NULL,
        "input_tokens" integer,
        "output_tokens" integer,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_messages" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ai_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations" ("id") ON DELETE CASCADE
      )`,
      `CREATE INDEX "ix_ai_messages_conversation_id" ON "ai_messages" ("conversation_id")`,
    ];

    for (const statement of statements) {
      await queryRunner.query(statement);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tablesInDropOrder = [
      'ai_messages',
      'ai_conversations',
      'notifications',
      'audit_logs',
      'progress_metrics',
      'exchange_rates',
      'attachments',
      'costs',
      'budget_items',
      'budgets',
      'cost_categories',
      'comments',
      'task_tags',
      'tags',
      'task_dependencies',
      'tasks',
      'project_members',
      'resource_profiles',
      'project_status_history',
      'projects',
      'user_roles',
      'roles',
      'users',
    ];

    for (const table of tablesInDropOrder) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }

    const enums = [
      'ai_message_role_enum',
      'notification_channel_enum',
      'audit_origin_enum',
      'audit_entity_type_enum',
      'dependency_type_enum',
      'task_priority_enum',
      'task_status_enum',
      'project_status_enum',
      'role_name_enum',
    ];

    for (const enumType of enums) {
      await queryRunner.query(`DROP TYPE IF EXISTS "${enumType}"`);
    }
  }
}
