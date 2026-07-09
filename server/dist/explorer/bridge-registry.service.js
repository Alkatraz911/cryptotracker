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
var BridgeRegistryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BridgeRegistryService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const bridge_address_entity_1 = require("./entities/bridge-address.entity");
let BridgeRegistryService = BridgeRegistryService_1 = class BridgeRegistryService {
    constructor(repo) {
        this.repo = repo;
        this.cache = null;
        this.loadedAt = 0;
    }
    async map() {
        if (this.cache && Date.now() - this.loadedAt < BridgeRegistryService_1.TTL)
            return this.cache;
        const rows = await this.repo.find();
        this.cache = new Map(rows.map((r) => [r.address.toLowerCase(), { bridge: r.bridge, name: r.name }]));
        this.loadedAt = Date.now();
        return this.cache;
    }
    async forAddress(address) {
        if (!address)
            return undefined;
        return (await this.map()).get(address.toLowerCase());
    }
    list() {
        return this.repo.find({ order: { bridge: 'ASC', name: 'ASC' } });
    }
    async add(entry) {
        const row = { address: entry.address.toLowerCase(), bridge: entry.bridge, name: entry.name };
        await this.repo.upsert(row, ['address']);
        this.cache = null;
        return (await this.repo.findOneByOrFail({ address: row.address }));
    }
    async remove(address) {
        await this.repo.delete({ address: address.toLowerCase() });
        this.cache = null;
    }
};
exports.BridgeRegistryService = BridgeRegistryService;
BridgeRegistryService.TTL = 60_000;
exports.BridgeRegistryService = BridgeRegistryService = BridgeRegistryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(bridge_address_entity_1.BridgeAddress)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], BridgeRegistryService);
//# sourceMappingURL=bridge-registry.service.js.map