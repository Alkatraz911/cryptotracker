import { MigrationInterface, QueryRunner } from 'typeorm';

// Seed the LI.FI Diamond (same address across EVM chains) so LI.FI-routed
// transfers are detected → the cross-chain button appears and the LI.FI adapter
// resolves the continuation. Admins can add more bridge addresses at runtime.
export class SeedLifiAddresses1719600000000 implements MigrationInterface {
  name = 'SeedLifiAddresses1719600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO "bridge_addresses" ("address", "bridge", "name") VALUES ($1, $2, $3) ON CONFLICT ("address") DO NOTHING`,
      ['0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', 'lifi', 'LI.FI: Diamond'],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM "bridge_addresses" WHERE "address" = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'`);
  }
}
