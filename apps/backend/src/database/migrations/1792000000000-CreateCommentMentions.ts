import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCommentMentions1792000000000 implements MigrationInterface {
  name = 'CreateCommentMentions1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "comment_mentions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "comment_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "name" character varying(150) NOT NULL,
        "start_index" integer NOT NULL,
        "end_index" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_comment_mentions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_comment_mentions_comment" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_comment_mentions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_comment_mentions_comment_id" ON "comment_mentions" ("comment_id");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_comment_mentions_user_id" ON "comment_mentions" ("user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_comment_mentions_user_id";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_comment_mentions_comment_id";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "comment_mentions";`);
  }
}
