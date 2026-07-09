"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeedLifiAddresses1719600000000 = void 0;
class SeedLifiAddresses1719600000000 {
    constructor() {
        this.name = 'SeedLifiAddresses1719600000000';
    }
    async up(q) {
        await q.query(`INSERT INTO "bridge_addresses" ("address", "bridge", "name") VALUES ($1, $2, $3) ON CONFLICT ("address") DO NOTHING`, ['0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', 'lifi', 'LI.FI: Diamond']);
    }
    async down(q) {
        await q.query(`DELETE FROM "bridge_addresses" WHERE "address" = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'`);
    }
}
exports.SeedLifiAddresses1719600000000 = SeedLifiAddresses1719600000000;
//# sourceMappingURL=1719600000000-SeedLifiAddresses.js.map