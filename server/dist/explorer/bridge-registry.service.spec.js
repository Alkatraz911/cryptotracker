"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const typeorm_1 = require("@nestjs/typeorm");
const bridge_registry_service_1 = require("./bridge-registry.service");
const bridge_address_entity_1 = require("./entities/bridge-address.entity");
describe('BridgeRegistryService', () => {
    const repo = { find: jest.fn(), upsert: jest.fn(), findOneByOrFail: jest.fn(), delete: jest.fn() };
    let svc;
    const ADDR = '0x' + 'ab'.repeat(20);
    beforeEach(async () => {
        jest.clearAllMocks();
        repo.find.mockResolvedValue([{ address: ADDR, bridge: 'orbiter', name: 'Orbiter Finance: Maker' }]);
        const m = await testing_1.Test.createTestingModule({
            providers: [bridge_registry_service_1.BridgeRegistryService, { provide: (0, typeorm_1.getRepositoryToken)(bridge_address_entity_1.BridgeAddress), useValue: repo }],
        }).compile();
        svc = m.get(bridge_registry_service_1.BridgeRegistryService);
    });
    it('matches case-insensitively and caches the table', async () => {
        const a = await svc.forAddress(ADDR.toUpperCase());
        const b = await svc.forAddress(ADDR);
        expect(a?.bridge).toBe('orbiter');
        expect(b?.name).toMatch(/Orbiter/);
        expect(repo.find).toHaveBeenCalledTimes(1);
    });
    it('returns undefined for unknown addresses', async () => {
        expect(await svc.forAddress('0x' + '11'.repeat(20))).toBeUndefined();
        expect(await svc.forAddress(null)).toBeUndefined();
    });
    it('invalidates the cache when an entry is added', async () => {
        await svc.forAddress(ADDR);
        repo.findOneByOrFail.mockResolvedValue({ address: '0xnew', bridge: 'debridge', name: 'deBridge' });
        await svc.add({ address: '0xNEW', bridge: 'debridge', name: 'deBridge' });
        expect(repo.upsert).toHaveBeenCalledWith({ address: '0xnew', bridge: 'debridge', name: 'deBridge' }, ['address']);
        await svc.forAddress(ADDR);
        expect(repo.find).toHaveBeenCalledTimes(2);
    });
});
//# sourceMappingURL=bridge-registry.service.spec.js.map