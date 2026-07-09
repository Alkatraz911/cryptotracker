import { MigrationInterface, QueryRunner } from 'typeorm';

// Bridge maker/contract address registry as a DB table (editable at runtime via
// API or direct insert — no rebuild needed). Seeded with the well-known entries.
export class AddBridgeAddresses1719300000000 implements MigrationInterface {
  name = 'AddBridgeAddresses1719300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "bridge_addresses" (
        "address" varchar NOT NULL,
        "bridge" varchar NOT NULL,
        "name" varchar NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bridge_addresses" PRIMARY KEY ("address")
      )
    `);
    const seed: Array<[string, string, string]> = [
      // deBridge (DLN) — canonical contracts, same address on every EVM chain.
      ['0xef4fb24ad0916217251f553c0596f8edc630eb66', 'debridge', 'deBridge: DLN Source'],
      ['0xe7351fd770a37282b91d153ee690b63579d6dd7f', 'debridge', 'deBridge: DLN Destination'],
      // Orbiter Finance — maker addresses (extend with verified makers).
      ['0x80c67432656d59144ceff962e8faf8926599bcf8', 'orbiter', 'Orbiter Finance: Maker'],
      ['0xee73323912a4e3772b74ed0ca1595a152b0ef282', 'orbiter', 'Orbiter Finance: Maker'],
      ['0x41d3d33156ae7c62c094aae2995003ae63f587b3', 'orbiter', 'Orbiter Finance: Maker'],
      ['0xd7aa9ba6caac7b0436c91396f22ca5a7f31664fc', 'orbiter', 'Orbiter Finance: Maker'],
    ];
    for (const [address, bridge, name] of seed) {
      await q.query(
        `INSERT INTO "bridge_addresses" ("address", "bridge", "name") VALUES ($1, $2, $3) ON CONFLICT ("address") DO NOTHING`,
        [address, bridge, name],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "bridge_addresses"`);
  }
}
