import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskInReviewStatus1790200000000 implements MigrationInterface {
  name = 'AddTaskInReviewStatus1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "task_status_enum" ADD VALUE IF NOT EXISTS 'IN_REVIEW'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.warn(
      'No se puede eliminar un valor de un enum en PostgreSQL. IN_REVIEW permanecerá en task_status_enum.',
    );
  }
}