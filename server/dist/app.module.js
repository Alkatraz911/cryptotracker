"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const auth_module_1 = require("./auth/auth.module");
const users_module_1 = require("./users/users.module");
const projects_module_1 = require("./projects/projects.module");
const explorer_module_1 = require("./explorer/explorer.module");
const chaindata_module_1 = require("./chaindata/chaindata.module");
const analytics_module_1 = require("./analytics/analytics.module");
const ai_module_1 = require("./ai/ai.module");
const user_entity_1 = require("./users/entities/user.entity");
const project_entity_1 = require("./projects/entities/project.entity");
const wallet_entity_1 = require("./chaindata/entities/wallet.entity");
const transaction_entity_1 = require("./chaindata/entities/transaction.entity");
const bridge_address_entity_1 = require("./explorer/entities/bridge-address.entity");
const usage_event_entity_1 = require("./analytics/entities/usage-event.entity");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            typeorm_1.TypeOrmModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (cfg) => ({
                    type: 'postgres',
                    url: cfg.get('DATABASE_URL'),
                    entities: [user_entity_1.User, project_entity_1.Project, wallet_entity_1.Wallet, transaction_entity_1.Transaction, bridge_address_entity_1.BridgeAddress, usage_event_entity_1.UsageEvent],
                    synchronize: false,
                    migrations: [__dirname + '/migrations/*.{js,ts}'],
                    migrationsRun: true,
                    ssl: cfg.get('DATABASE_URL', '').includes('sslmode=require')
                        ? { rejectUnauthorized: false }
                        : false,
                }),
            }),
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            projects_module_1.ProjectsModule,
            explorer_module_1.ExplorerModule,
            chaindata_module_1.ChainDataModule,
            analytics_module_1.AnalyticsModule,
            ai_module_1.AiModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map