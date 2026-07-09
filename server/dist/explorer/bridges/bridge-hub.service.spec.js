"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bridge_hub_service_1 = require("./bridge-hub.service");
const hop = { sourceId: '0xa', targetId: '0xb' };
function adapter(id, result) {
    return { id, name: id.toUpperCase(), resolve: jest.fn().mockResolvedValue({ outOfRange: false, ...result }) };
}
describe('BridgeHubService', () => {
    it('lists registered resolvers and reports membership', () => {
        const hub = new bridge_hub_service_1.BridgeHubService(adapter('orbiter', { hop: null }), adapter('debridge', { hop: null }), adapter('lifi', { hop: null }), adapter('across', { hop: null }));
        expect(hub.resolvers().map((r) => r.id).sort()).toEqual(['across', 'debridge', 'lifi', 'orbiter']);
        expect(hub.has('lifi')).toBe(true);
        expect(hub.has('unknown')).toBe(false);
    });
    it('resolve targets only the requested adapter', async () => {
        const orbiter = adapter('orbiter', { hop });
        const lifi = adapter('lifi', { hop: null });
        const hub = new bridge_hub_service_1.BridgeHubService(orbiter, adapter('debridge', { hop: null }), lifi, adapter('across', { hop: null }));
        const r = await hub.resolve('orbiter', '0xh', {});
        expect(r.hop).toBe(hop);
        expect(orbiter.resolve).toHaveBeenCalled();
        expect(lifi.resolve).not.toHaveBeenCalled();
    });
    it('resolve returns null for an unknown bridge id', async () => {
        const hub = new bridge_hub_service_1.BridgeHubService(adapter('orbiter', { hop }), adapter('debridge', { hop }), adapter('lifi', { hop }), adapter('across', { hop }));
        expect((await hub.resolve('nope', '0xh', {})).hop).toBeNull();
    });
    it('resolveAny returns the first adapter that finds a hop', async () => {
        const hub = new bridge_hub_service_1.BridgeHubService(adapter('orbiter', { hop: null }), adapter('debridge', { hop }), adapter('lifi', { hop: null }), adapter('across', { hop: null }));
        expect((await hub.resolveAny('0xh', {})).hop).toBe(hop);
    });
    it('resolveAny preserves outOfRange when nothing matches', async () => {
        const hub = new bridge_hub_service_1.BridgeHubService(adapter('orbiter', { hop: null, outOfRange: true }), adapter('debridge', { hop: null }), adapter('lifi', { hop: null }), adapter('across', { hop: null }));
        const r = await hub.resolveAny('0xh', {});
        expect(r.hop).toBeNull();
        expect(r.outOfRange).toBe(true);
    });
});
//# sourceMappingURL=bridge-hub.service.spec.js.map