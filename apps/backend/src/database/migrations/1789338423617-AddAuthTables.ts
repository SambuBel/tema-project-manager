import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega las tablas necesarias para el login con Google:
 *  - external_accounts: identidades OAuth vinculadas a un user.
 *  - authorized_domains: catalogo configurable de dominios de email permitidos.
 * No modifica ni recrea ninguna tabla existente.
 */
export class AddAuthTables1789338423617 implements MigrationInterface {
  name = 'AddAuthTables1789338423617';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const statements = [
      `CREATE TYPE "external_account_provider_enum" AS ENUM ('GOOGLE')`,

      `CREATE TABLE "external_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "provider" "external_account_provider_enum" NOT NULL,
        "provider_subject" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL,
        "email_verified" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_external_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "fk_external_accounts_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )`,
      `CREATE UNIQUE INDEX "ux_external_accounts_provider_subject" ON "external_accounts" ("provider", "provider_subject")`,
      `CREATE INDEX "ix_external_accounts_user_id" ON "external_accounts" ("user_id")`,

      `CREATE TABLE "authorized_domains" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "domain" varchar(255) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_authorized_domains" PRIMARY KEY ("id"),
        CONSTRAINT "ux_authorized_domains_domain" UNIQUE ("domain")
      )`,
    ];

    for (const statement of statements) {
      await queryRunner.query(statement);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "authorized_domains" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "external_accounts" CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS "external_account_provider_enum"`);
  }
}
