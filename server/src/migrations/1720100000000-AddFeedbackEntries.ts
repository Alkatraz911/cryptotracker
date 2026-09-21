import { MigrationInterface, QueryRunner } from 'typeorm';

// Storage for the in-app feedback form (bug reports + improvement ideas).
export class AddFeedbackEntries1720100000000 implements MigrationInterface {
  name = 'AddFeedbackEntries1720100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "feedback_entries" (
        "id" BIGSERIAL PRIMARY KEY,
        "user_id" varchar NOT NULL,
        "email" varchar NOT NULL,
        "kind" varchar NOT NULL,
        "title" varchar NOT NULL,
        "message" text NOT NULL,
        "context" jsonb,
        "status" varchar NOT NULL DEFAULT 'new',
        "created_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_feedback_entries_status" ON "feedback_entries" ("status")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_feedback_entries_created_at" ON "feedback_entries" ("created_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "feedback_entries"`);
  }
}
