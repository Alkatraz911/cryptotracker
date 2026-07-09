"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChainDataModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const explorer_module_1 = require("../explorer/explorer.module");
const chaindata_service_1 = require("./chaindata.service");
const chaindata_controller_1 = require("./chaindata.controller");
const wallet_entity_1 = require("./entities/wallet.entity");
const transaction_entity_1 = require("./entities/transaction.entity");
let ChainDataModule = class ChainDataModule {
};
exports.ChainDataModule = ChainDataModule;
exports.ChainDataModule = ChainDataModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([wallet_entity_1.Wallet, transaction_entity_1.Transaction]), explorer_module_1.ExplorerModule],
        providers: [chaindata_service_1.ChainDataService],
        controllers: [chaindata_controller_1.ChainDataController],
    })
], ChainDataModule);
//# sourceMappingURL=chaindata.module.js.map