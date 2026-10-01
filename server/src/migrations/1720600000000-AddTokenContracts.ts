import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTokenContracts1720600000000 implements MigrationInterface {
  name = 'AddTokenContracts1720600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "token_contract" varchar`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_transactions_network_token_contract" ON "transactions" ("network", "token_contract")`);
    await q.query(`CREATE TABLE IF NOT EXISTS "token_contracts" (
      "network" varchar NOT NULL, "contract" varchar NOT NULL,
      "symbol" varchar, "name" varchar, "decimals" integer,
      "status" varchar NOT NULL DEFAULT 'unknown', "source" varchar NOT NULL DEFAULT 'seen',
      "reason" varchar, "coingecko_id" varchar,
      "seen_count" integer NOT NULL DEFAULT 0,
      "first_seen" timestamptz NOT NULL DEFAULT now(), "last_seen" timestamptz NOT NULL DEFAULT now(),
      "updated_by" varchar, "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_token_contracts" PRIMARY KEY ("network", "contract")
    )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "token_contracts"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_transactions_network_token_contract"`);
    await q.query(`ALTER TABLE "transactions" DROP COLUMN IF EXISTS "token_contract"`);
  }
}
