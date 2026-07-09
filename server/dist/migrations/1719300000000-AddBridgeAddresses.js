"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddBridgeAddresses1719300000000 = void 0;
class AddBridgeAddresses1719300000000 {
    constructor() {
        this.name = 'AddBridgeAddresses1719300000000';
    }
    async up(q) {
        await q.query(`
      CREATE TABLE IF NOT EXISTS "bridge_addresses" (
        "address" varchar NOT NULL,
        "bridge" varchar NOT NULL,
        "name" varchar NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bridge_addresses" PRIMARY KEY ("address")
      )
    `);
        const seed = [
            ['0xef4fb24ad0916217251f553c0596f8edc630eb66', 'debridge', 'deBridge: DLN Source'],
            ['0xe7351fd770a37282b91d153ee690b63579d6dd7f', 'debridge', 'deBridge: DLN Destination'],
            ['0x80c67432656d59144ceff962e8faf8926599bcf8', 'orbiter', 'Orbiter Finance: Maker'],
            ['0xee73323912a4e3772b74ed0ca1595a152b0ef282', 'orbiter', 'Orbiter Finance: Maker'],
            ['0x41d3d33156ae7c62c094aae2995003ae63f587b3', 'orbiter', 'Orbiter Finance: Maker'],
            ['0xd7aa9ba6caac7b0436c91396f22ca5a7f31664fc', 'orbiter', 'Orbiter Finance: Maker'],
        ];
        for (const [address, bridge, name] of seed) {
            await q.query(`INSERT INTO "bridge_addresses" ("address", "bridge", "name") VALUES ($1, $2, $3) ON CONFLICT ("address") DO NOTHING`, [address, bridge, name]);
        }
    }
    async down(q) {
        await q.query(`DROP TABLE IF EXISTS "bridge_addresses"`);
    }
}
exports.AddBridgeAddresses1719300000000 = AddBridgeAddresses1719300000000;
//# sourceMappingURL=1719300000000-AddBridgeAddresses.js.map