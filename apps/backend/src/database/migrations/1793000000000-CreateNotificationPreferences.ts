import { MigrationInterface, QueryRunner } from 'typeorm';

/** RF-NO-04: qué tipos de notificación quiere recibir cada usuario. */
export class CreateNotificationPreferences1793000000000 implements MigrationInterface {
  name = 'CreateNotificationPreferences1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE "notification_preferences" (' +
        '"user_id" uuid NOT NULL, ' +
        '"type" varchar(50) NOT NULL, ' +
        '"enabled" boolean NOT NULL DEFAULT true, ' +
        '"updated_at" timestamptz NOT NULL DEFAULT now(), ' +
        'CONSTRAINT "pk_notification_preferences" PRIMARY KEY ("user_id", "type"), ' +
        'CONSTRAINT "fk_notification_preferences_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE' +
        ')',
    );
    // Dedupe de las alertas automáticas (vencimientos, presupuesto, desvío): se consulta por usuario + tipo + tarea/proyecto.
    await queryRunner.query(
      'CREATE INDEX "ix_notifications_user_type_task" ON "notifications" ("user_id", "type", "task_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "ix_notifications_user_type_project" ON "notifications" ("user_id", "type", "project_id")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "ix_notifications_user_type_project"');
    await queryRunner.query('DROP INDEX "ix_notifications_user_type_task"');
    await queryRunner.query('DROP TABLE "notification_preferences"');
  }
}