import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega los valores que faltaban para la funcionalidad "Crear tarea":
 *  - task_status_enum:   IN_REVIEW (entre IN_PROGRESS y COMPLETED)
 *  - task_priority_enum: CRITICAL  (despues de HIGH)
 * Solo AGREGA valores: no toca tablas ni datos existentes. IF NOT EXISTS la hace idempotente.
 */
export class AddTaskReviewStatusAndCriticalPriority1790037804973 implements MigrationInterface {
  name = 'AddTaskReviewStatusAndCriticalPriority1790037804973';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "task_status_enum" ADD VALUE IF NOT EXISTS 'IN_REVIEW' AFTER 'IN_PROGRESS'`);
    await queryRunner.query(`ALTER TYPE "task_priority_enum" ADD VALUE IF NOT EXISTS 'CRITICAL' AFTER 'HIGH'`);
  }

  public async down(): Promise<void> {
    // Postgres no permite quitar un valor de un ENUM sin recrear el tipo, y hacerlo podria
    // romper filas que ya usan IN_REVIEW / CRITICAL. Por seguridad el revert no borra nada:
    // los valores extra quedan en el tipo (inofensivos si nadie los usa).
  }
}
