import { MigrationInterface, QueryRunner } from 'typeorm';

// Queue of addresses whose OKX Explorer tag the userscript should collect.
export class AddOkxLabelQueue1720400000000 implements MigrationInterface {
  name = 'AddOkxLabelQueue1720400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "okx_label_queue" (
        "address" varchar NOT NULL,
        "network" varchar NOT NULL,
        "tx_hash" varchar,
        "status" varchar NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "claimed_at" TIMESTAMPTZ,
        "claimed_by" varchar,
        "last_error" varchar,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_okx_label_queue" PRIMARY KEY ("address")
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_okx_label_queue_status" ON "okx_label_queue" ("status", "created_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "okx_label_queue"`);
  }
}
