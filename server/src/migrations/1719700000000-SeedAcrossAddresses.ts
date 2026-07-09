import { MigrationInterface, QueryRunner } from 'typeorm';

// Seed Across SpokePool contracts (one per chain, unlike deBridge/LI.FI which
// share an address) so Across-routed transfers are detected → the cross-chain
// button appears and the Across adapter resolves the continuation. Admins can
// add more chains' SpokePools at runtime.
export class SeedAcrossAddresses1719700000000 implements MigrationInterface {
  name = 'SeedAcrossAddresses1719700000000';

  private readonly seed: Array<[string, string, string]> = [
    ['0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5', 'across', 'Across: SpokePool (Ethereum)'],
    ['0x6f26bf09b1c792e3228e5467807a900a503c0281', 'across', 'Across: SpokePool (Optimism)'],
    ['0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096', 'across', 'Across: SpokePool (Polygon)'],
    ['0xe35e9842fceaca96570b734083f4a58e8f7c5f2a', 'across', 'Across: SpokePool (Arbitrum)'],
    ['0x09aea4b2242abc8bb4bb78d537a67a245a7bec64', 'across', 'Across: SpokePool (Base)'],
    ['0x89415a82d909a7238d69094c3dd1dcc1acbda85c', 'across', 'Across: SpokePool (BSC)'],
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const [address, bridge, name] of this.seed) {
      await q.query(
        `INSERT INTO "bridge_addresses" ("address", "bridge", "name") VALUES ($1, $2, $3) ON CONFLICT ("address") DO NOTHING`,
        [address, bridge, name],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [address] of this.seed) {
      await q.query(`DELETE FROM "bridge_addresses" WHERE "address" = $1`, [address]);
    }
  }
}
