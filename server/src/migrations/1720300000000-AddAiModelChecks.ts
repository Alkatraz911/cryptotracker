import { MigrationInterface, QueryRunner } from 'typeorm';

// Health of LLM model ids for the AI model picker (probe results + failures).
export class AddAiModelChecks1720300000000 implements MigrationInterface {
  name = 'AddAiModelChecks1720300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_model_checks" (
        "model" varchar NOT NULL,
        "ok" boolean NOT NULL,
        "error" varchar,
        "latency_ms" integer,
        "checked_at" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "PK_ai_model_checks" PRIMARY KEY ("model")
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ai_model_checks"`);
  }
}
