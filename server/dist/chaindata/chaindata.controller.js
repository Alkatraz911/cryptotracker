"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChainDataController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const chaindata_service_1 = require("./chaindata.service");
let ChainDataController = class ChainDataController {
    constructor(chaindata) {
        this.chaindata = chaindata;
    }
    getWallet(network, address, native, token, limit, force, from, to, asset) {
        if (!network || !address)
            return { transfers: [], diag: null };
        return this.chaindata.walletTransfers(network, address, {
            native: native !== 'false',
            token: token !== 'false',
            limit: limit ? Number(limit) : 2000,
            force: force === 'true',
            fromMs: from ? Number(from) : undefined,
            toMs: to ? Number(to) : undefined,
            asset: asset || undefined,
        });
    }
};
exports.ChainDataController = ChainDataController;
__decorate([
    (0, common_1.Get)('wallet'),
    __param(0, (0, common_1.Query)('network')),
    __param(1, (0, common_1.Query)('address')),
    __param(2, (0, common_1.Query)('native')),
    __param(3, (0, common_1.Query)('token')),
    __param(4, (0, common_1.Query)('limit')),
    __param(5, (0, common_1.Query)('force')),
    __param(6, (0, common_1.Query)('from')),
    __param(7, (0, common_1.Query)('to')),
    __param(8, (0, common_1.Query)('asset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], ChainDataController.prototype, "getWallet", null);
exports.ChainDataController = ChainDataController = __decorate([
    (0, common_1.Controller)('chaindata'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [chaindata_service_1.ChainDataService])
], ChainDataController);
//# sourceMappingURL=chaindata.controller.js.map