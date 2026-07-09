"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExplorerModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const explorer_service_1 = require("./explorer.service");
const explorer_controller_1 = require("./explorer.controller");
const bridge_registry_service_1 = require("./bridge-registry.service");
const bridge_address_entity_1 = require("./entities/bridge-address.entity");
const evm_provider_1 = require("./providers/evm.provider");
const tron_provider_1 = require("./providers/tron.provider");
const solana_provider_1 = require("./providers/solana.provider");
const orbiter_provider_1 = require("./providers/orbiter.provider");
const debridge_provider_1 = require("./providers/debridge.provider");
const price_provider_1 = require("./providers/price.provider");
const bridge_hub_service_1 = require("./bridges/bridge-hub.service");
const orbiter_adapter_1 = require("./bridges/orbiter.adapter");
const debridge_adapter_1 = require("./bridges/debridge.adapter");
const lifi_adapter_1 = require("./bridges/lifi.adapter");
const across_adapter_1 = require("./bridges/across.adapter");
const provider_health_service_1 = require("./provider-health.service");
let ExplorerModule = class ExplorerModule {
};
exports.ExplorerModule = ExplorerModule;
exports.ExplorerModule = ExplorerModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([bridge_address_entity_1.BridgeAddress])],
        providers: [
            explorer_service_1.ExplorerService, bridge_registry_service_1.BridgeRegistryService, provider_health_service_1.ProviderHealthService,
            evm_provider_1.EvmProvider, tron_provider_1.TronProvider, solana_provider_1.SolanaProvider, orbiter_provider_1.OrbiterProvider, debridge_provider_1.DebridgeProvider, price_provider_1.PriceProvider,
            bridge_hub_service_1.BridgeHubService, orbiter_adapter_1.OrbiterAdapter, debridge_adapter_1.DebridgeAdapter, lifi_adapter_1.LifiAdapter, across_adapter_1.AcrossAdapter,
        ],
        controllers: [explorer_controller_1.ExplorerController],
        exports: [explorer_service_1.ExplorerService],
    })
], ExplorerModule);
//# sourceMappingURL=explorer.module.js.map