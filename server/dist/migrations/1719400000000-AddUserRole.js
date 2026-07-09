"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddUserRole1719400000000 = void 0;
class AddUserRole1719400000000 {
    constructor() {
        this.name = 'AddUserRole1719400000000';
    }
    async up(q) {
        await q.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" varchar NOT NULL DEFAULT 'user'`);
    }
    async down(q) {
        await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "role"`);
    }
}
exports.AddUserRole1719400000000 = AddUserRole1719400000000;
//# sourceMappingURL=1719400000000-AddUserRole.js.map