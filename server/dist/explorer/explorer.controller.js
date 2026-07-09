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
exports.ExplorerController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const admin_guard_1 = require("../auth/guards/admin.guard");
const explorer_service_1 = require("./explorer.service");
const bridge_registry_service_1 = require("./bridge-registry.service");
const bridge_hub_service_1 = require("./bridges/bridge-hub.service");
const provider_health_service_1 = require("./provider-health.service");
const add_bridge_dto_1 = require("./dto/add-bridge.dto");
let ExplorerController = class ExplorerController {
    constructor(explorer, bridges, bridgeHub, health) {
        this.explorer = explorer;
        this.bridges = bridges;
        this.bridgeHub = bridgeHub;
        this.health = health;
    }
    sourceHealth() {
        const sources = this.health.snapshot();
        const degraded = sources.filter((s) => s.status === 'down' || s.status === 'drift');
        return { generatedAt: Date.now(), ok: degraded.length === 0, degraded: degraded.map((s) => s.source), sources };
    }
    listResolvers() {
        return this.bridgeHub.resolvers();
    }
    listBridges() {
        return this.bridges.list();
    }
    addBridge(dto) {
        return this.bridges.add(dto);
    }
    async removeBridge(address) {
        await this.bridges.remove(address);
        return { ok: true };
    }
    async getTx(network, hash) {
        if (!network || !hash)
            return { data: null, diag: null };
        try {
            const data = await this.explorer.fetchTx(network.toUpperCase(), hash);
            return { data, diag: data ? null : `${network}: RPC вернул пустой ответ (tx не найдена или RPC недоступен)` };
        }
        catch (e) {
            return { data: null, diag: String(e?.message || e) };
        }
    }
    getLabel(network, address) {
        if (!network || !address)
            return { label: null };
        return this.explorer.fetchAddressLabel(network.toUpperCase(), address);
    }
    getWallet(network, address, native, token, limit, labels) {
        if (!network || !address)
            return { transfers: [] };
        return this.explorer.fetchWalletTransfers(network.toUpperCase(), address, {
            native: native !== 'false',
            token: token !== 'false',
            limit: limit ? Number(limit) : 50,
            labels: labels !== 'false',
        });
    }
    async getBalance(network, address) {
        if (!network || !address)
            return { amount: null, asset: '', usdValue: null, diag: 'network и address обязательны' };
        return this.explorer.fetchBalance(network.toUpperCase(), address);
    }
    async trace(network, address, direction, hops, minUsd, perNode) {
        if (!network || !address)
            return { transfers: [], hops: [], terminals: [], stats: {}, diag: 'network и address обязательны' };
        return this.explorer.traceFlow({
            network: network.toUpperCase(),
            address,
            direction: direction === 'in' ? 'in' : 'out',
            maxHops: hops ? Number(hops) : undefined,
            minUsd: minUsd ? Number(minUsd) : undefined,
            perNode: perNode ? Number(perNode) : undefined,
        });
    }
    async orbiterResolve(hash, chainId, ts, bridge) {
        if (!hash)
            return { hop: null, diag: 'hash обязателен' };
        const prefer = bridge || undefined;
        const { hop, outOfRange } = await this.explorer.bridgeResolve(hash, chainId || undefined, ts ? Number(ts) : undefined, false, prefer);
        const diag = hop ? null
            : outOfRange ? 'Мост: транзакция старше доступной глубины (резолв работает по недавней истории)'
                : 'Мост: кроссчейн-перевод для этой транзакции не найден';
        return { hop, diag };
    }
    async debridgeFeed(source, target, minUsd, since, limit) {
        return this.explorer.debridgeFeed({
            sourceChain: source || undefined,
            targetChain: target || undefined,
            minUsd: minUsd ? Number(minUsd) : undefined,
            sinceMs: since ? Number(since) : undefined,
            limit: limit ? Number(limit) : undefined,
        });
    }
    async orbiterFeed(source, target, minUsd, since, until, limit) {
        if (!source)
            return { hops: [], diag: 'source (сеть-источник) обязательна' };
        return this.explorer.orbiterFeed({
            sourceChain: source,
            targetChain: target || undefined,
            minUsd: minUsd ? Number(minUsd) : undefined,
            sinceMs: since ? Number(since) : undefined,
            untilMs: until ? Number(until) : undefined,
            limit: limit ? Number(limit) : undefined,
        });
    }
};
exports.ExplorerController = ExplorerController;
__decorate([
    (0, common_1.Get)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ExplorerController.prototype, "sourceHealth", null);
__decorate([
    (0, common_1.Get)('bridges/resolvers'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ExplorerController.prototype, "listResolvers", null);
__decorate([
    (0, common_1.Get)('bridges'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ExplorerController.prototype, "listBridges", null);
__decorate([
    (0, common_1.Post)('bridges'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [add_bridge_dto_1.AddBridgeDto]),
    __metadata("design:returntype", void 0)
], ExplorerController.prototype, "addBridge", null);
__decorate([
    (0, common_1.Delete)('bridges/:address'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('address')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ExplorerController.prototype, "removeBridge", null);
__decorate([
    (0, common_1.Get)('tx'),
    __param(0, (0, common_1.Query)('network')),
    __param(1, (0, common_1.Query)('hash')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ExplorerController.prototype, "getTx", null);
__decorate([
    (0, common_1.Get)('label'),
    __param(0, (0, common_1.Query)('network')),
    __param(1, (0, common_1.Query)('address')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ExplorerController.prototype, "getLabel", null);
__decorate([
    (0, common_1.Get)('wallet'),
    __param(0, (0, common_1.Query)('network')),
    __param(1, (0, common_1.Query)('address')),
    __param(2, (0, common_1.Query)('native')),
    __param(3, (0, common_1.Query)('token')),
    __param(4, (0, common_1.Query)('limit')),
    __param(5, (0, common_1.Query)('labels')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], ExplorerController.prototype, "getWallet", null);
__decorate([
    (0, common_1.Get)('balance'),
    __param(0, (0, common_1.Query)('network')),
    __param(1, (0, common_1.Query)('address')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ExplorerController.prototype, "getBalance", null);
__decorate([
    (0, common_1.Get)('trace'),
    __param(0, (0, common_1.Query)('network')),
    __param(1, (0, common_1.Query)('address')),
    __param(2, (0, common_1.Query)('direction')),
    __param(3, (0, common_1.Query)('hops')),
    __param(4, (0, common_1.Query)('minUsd')),
    __param(5, (0, common_1.Query)('perNode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], ExplorerController.prototype, "trace", null);
__decorate([
    (0, common_1.Get)('orbiter/resolve'),
    __param(0, (0, common_1.Query)('hash')),
    __param(1, (0, common_1.Query)('chainId')),
    __param(2, (0, common_1.Query)('ts')),
    __param(3, (0, common_1.Query)('bridge')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", Promise)
], ExplorerController.prototype, "orbiterResolve", null);
__decorate([
    (0, common_1.Get)('debridge/feed'),
    __param(0, (0, common_1.Query)('source')),
    __param(1, (0, common_1.Query)('target')),
    __param(2, (0, common_1.Query)('minUsd')),
    __param(3, (0, common_1.Query)('since')),
    __param(4, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], ExplorerController.prototype, "debridgeFeed", null);
__decorate([
    (0, common_1.Get)('orbiter/feed'),
    __param(0, (0, common_1.Query)('source')),
    __param(1, (0, common_1.Query)('target')),
    __param(2, (0, common_1.Query)('minUsd')),
    __param(3, (0, common_1.Query)('since')),
    __param(4, (0, common_1.Query)('until')),
    __param(5, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], ExplorerController.prototype, "orbiterFeed", null);
exports.ExplorerController = ExplorerController = __decorate([
    (0, common_1.Controller)('explorer'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [explorer_service_1.ExplorerService,
        bridge_registry_service_1.BridgeRegistryService,
        bridge_hub_service_1.BridgeHubService,
        provider_health_service_1.ProviderHealthService])
], ExplorerController);
//# sourceMappingURL=explorer.controller.js.map