"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const user_entity_1 = require("./users/entities/user.entity");
const project_entity_1 = require("./projects/entities/project.entity");
const wallet_entity_1 = require("./chaindata/entities/wallet.entity");
const transaction_entity_1 = require("./chaindata/entities/transaction.entity");
const bridge_address_entity_1 = require("./explorer/entities/bridge-address.entity");
const usage_event_entity_1 = require("./analytics/entities/usage-event.entity");
try {
    require('dotenv').config();
}
catch { }
exports.default = new typeorm_1.DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [user_entity_1.User, project_entity_1.Project, wallet_entity_1.Wallet, transaction_entity_1.Transaction, bridge_address_entity_1.BridgeAddress, usage_event_entity_1.UsageEvent],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    synchronize: false,
    ssl: (process.env.DATABASE_URL ?? '').includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : false,
});
//# sourceMappingURL=data-source.js.map