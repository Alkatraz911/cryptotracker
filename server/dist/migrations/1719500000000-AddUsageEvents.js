"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddUsageEvents1719500000000 = void 0;
class AddUsageEvents1719500000000 {
    constructor() {
        this.name = 'AddUsageEvents1719500000000';
    }
    async up(q) {
        await q.query(`
      CREATE TABLE IF NOT EXISTS "usage_events" (
        "id" BIGSERIAL NOT NULL,
        "user_id" varchar NOT NULL,
        "module" varchar NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_usage_events" PRIMARY KEY ("id")
      )
    `);
        await q.query(`CREATE INDEX IF NOT EXISTS "IDX_usage_module" ON "usage_events" ("module")`);
        await q.query(`CREATE INDEX IF NOT EXISTS "IDX_usage_user" ON "usage_events" ("user_id")`);
        await q.query(`CREATE INDEX IF NOT EXISTS "IDX_usage_created" ON "usage_events" ("created_at")`);
    }
    async down(q) {
        await q.query(`DROP INDEX IF EXISTS "IDX_usage_created"`);
        await q.query(`DROP INDEX IF EXISTS "IDX_usage_user"`);
        await q.query(`DROP INDEX IF EXISTS "IDX_usage_module"`);
        await q.query(`DROP TABLE IF EXISTS "usage_events"`);
    }
}
exports.AddUsageEvents1719500000000 = AddUsageEvents1719500000000;
//# sourceMappingURL=1719500000000-AddUsageEvents.js.map