import { MigrationInterface, QueryRunner } from 'typeorm';

// The background OKX harvest was dropped (OKX blocks it after a few pages), and
// its work queue with it.
export class DropOkxLabelQueue1720500000000 implements MigrationInterface {
  name = 'DropOkxLabelQueue1720500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "okx_label_queue"`);
  }

  public async down(q: QueryRunner): Promise<void> {
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
  }
}
