import { MigrationInterface, QueryRunner } from 'typeorm';

// Usage-event log powering the admin analytics view (module demand per user).
export class AddUsageEvents1719500000000 implements MigrationInterface {
  name = 'AddUsageEvents1719500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "usage_events" (
        "id" BIGSERIAL NOT NULL,
        "user_id" varchar NOT NULL,
        "module" varchar NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_usage_events" PRIMARY KEY ("id")
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_usage_module" ON "usage_events" ("module")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_usage_user" ON "usage_events" ("user_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_usage_created" ON "usage_events" ("created_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_usage_created"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_usage_user"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_usage_module"`);
    await q.query(`DROP TABLE IF EXISTS "usage_events"`);
  }
}
