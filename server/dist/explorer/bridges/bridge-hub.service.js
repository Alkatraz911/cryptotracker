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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BridgeHubService = void 0;
const common_1 = require("@nestjs/common");
const orbiter_adapter_1 = require("./orbiter.adapter");
const debridge_adapter_1 = require("./debridge.adapter");
const lifi_adapter_1 = require("./lifi.adapter");
const across_adapter_1 = require("./across.adapter");
let BridgeHubService = class BridgeHubService {
    constructor(orbiter, debridge, lifi, across) {
        this.adapters = new Map();
        for (const a of [orbiter, debridge, lifi, across])
            this.adapters.set(a.id, a);
    }
    resolvers() {
        return [...this.adapters.values()].map((a) => ({ id: a.id, name: a.name }));
    }
    has(id) {
        return !!id && this.adapters.has(id);
    }
    async resolve(bridgeId, hash, ctx) {
        const a = this.adapters.get(bridgeId);
        if (!a)
            return { hop: null, outOfRange: false };
        return a.resolve(hash, ctx);
    }
    async resolveAny(hash, ctx) {
        const results = await Promise.all([...this.adapters.values()].map((a) => a.resolve(hash, ctx).catch(() => ({ hop: null, outOfRange: false }))));
        const hit = results.find((r) => r.hop);
        if (hit)
            return hit;
        return { hop: null, outOfRange: results.some((r) => r.outOfRange) };
    }
};
exports.BridgeHubService = BridgeHubService;
exports.BridgeHubService = BridgeHubService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [orbiter_adapter_1.OrbiterAdapter, debridge_adapter_1.DebridgeAdapter, lifi_adapter_1.LifiAdapter, across_adapter_1.AcrossAdapter])
], BridgeHubService);
//# sourceMappingURL=bridge-hub.service.js.map