import { MigrationInterface, QueryRunner } from 'typeorm';

// Provenance on each stored transfer fact: which data source produced it and
// when it was pulled into the store — so a case can cite where every number
// came from (see the case export / reliability layer).
export class AddTxProvenance1719800000000 implements MigrationInterface {
  name = 'AddTxProvenance1719800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "source" varchar`);
    await q.query(`ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "fetched_at" timestamptz`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "transactions" DROP COLUMN IF EXISTS "fetched_at"`);
    await q.query(`ALTER TABLE "transactions" DROP COLUMN IF EXISTS "source"`);
  }
}
