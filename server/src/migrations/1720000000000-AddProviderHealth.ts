import { MigrationInterface, QueryRunner } from 'typeorm';

// Bootstrap table for provider-health tracking, replacing the local JSON file
// (server/src/explorer/provider-health.service.ts) which — being debounced
// and in-memory-cached — doesn't survive Vercel's per-invocation filesystem.
export class AddProviderHealth1720000000000 implements MigrationInterface {
  name = 'AddProviderHealth1720000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "provider_health" (
        "source" varchar NOT NULL,
        "status" varchar NOT NULL DEFAULT 'unknown',
        "lastOkAt" bigint,
        "lastFailAt" bigint,
        "lastDriftAt" bigint,
        "consecutiveFailures" integer NOT NULL DEFAULT 0,
        "totalOk" integer NOT NULL DEFAULT 0,
        "totalFail" integer NOT NULL DEFAULT 0,
        "totalDrift" integer NOT NULL DEFAULT 0,
        "lastNote" varchar,
        "lastLatencyMs" bigint,
        CONSTRAINT "PK_provider_health" PRIMARY KEY ("source")
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "provider_health"`);
  }
}
