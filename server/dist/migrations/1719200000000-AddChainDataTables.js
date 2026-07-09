"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddChainDataTables1719200000000 = void 0;
class AddChainDataTables1719200000000 {
    constructor() {
        this.name = 'AddChainDataTables1719200000000';
    }
    async up(q) {
        await q.query(`
      CREATE TABLE IF NOT EXISTS "wallets" (
        "network" varchar NOT NULL,
        "address" varchar NOT NULL,
        "entity_label" varchar,
        "txs_loaded_at" timestamptz,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallets" PRIMARY KEY ("network", "address")
      )
    `);
        await q.query(`
      CREATE TABLE IF NOT EXISTS "transactions" (
        "dedup_key" varchar NOT NULL,
        "network" varchar NOT NULL,
        "hash" varchar NOT NULL,
        "block_ts" bigint,
        "from_addr" varchar,
        "to_addr" varchar,
        "asset" varchar,
        "amount" double precision,
        "usd" double precision,
        "from_label" varchar,
        "to_label" varchar,
        CONSTRAINT "PK_transactions" PRIMARY KEY ("dedup_key")
      )
    `);
        await q.query(`CREATE INDEX IF NOT EXISTS "IDX_tx_network_from" ON "transactions" ("network", "from_addr")`);
        await q.query(`CREATE INDEX IF NOT EXISTS "IDX_tx_network_to" ON "transactions" ("network", "to_addr")`);
        await q.query(`CREATE INDEX IF NOT EXISTS "IDX_tx_block_ts" ON "transactions" ("block_ts")`);
        await q.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "tx_cache"`);
    }
    async down(q) {
        await q.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "tx_cache" jsonb NOT NULL DEFAULT '{}'`);
        await q.query(`DROP INDEX IF EXISTS "IDX_tx_block_ts"`);
        await q.query(`DROP INDEX IF EXISTS "IDX_tx_network_to"`);
        await q.query(`DROP INDEX IF EXISTS "IDX_tx_network_from"`);
        await q.query(`DROP TABLE IF EXISTS "transactions"`);
        await q.query(`DROP TABLE IF EXISTS "wallets"`);
    }
}
exports.AddChainDataTables1719200000000 = AddChainDataTables1719200000000;
//# sourceMappingURL=1719200000000-AddChainDataTables.js.map