import { BridgeHubService } from './bridge-hub.service';
import type { BridgeAdapter, BridgeHop } from './bridge-adapter.interface';

const hop = { sourceId: '0xa', targetId: '0xb' } as unknown as BridgeHop;

function adapter(id: string, result: { hop: BridgeHop | null; outOfRange?: boolean }): BridgeAdapter {
  return { id, name: id.toUpperCase(), resolve: jest.fn().mockResolvedValue({ outOfRange: false, ...result }) };
}

describe('BridgeHubService', () => {
  it('lists registered resolvers and reports membership', () => {
    const hub = new BridgeHubService(adapter('orbiter', { hop: null }) as any, adapter('debridge', { hop: null }) as any, adapter('lifi', { hop: null }) as any, adapter('across', { hop: null }) as any);
    expect(hub.resolvers().map((r) => r.id).sort()).toEqual(['across', 'debridge', 'lifi', 'orbiter']);
    expect(hub.has('lifi')).toBe(true);
    expect(hub.has('unknown')).toBe(false);
  });

  it('resolve targets only the requested adapter', async () => {
    const orbiter = adapter('orbiter', { hop });
    const lifi = adapter('lifi', { hop: null });
    const hub = new BridgeHubService(orbiter as any, adapter('debridge', { hop: null }) as any, lifi as any, adapter('across', { hop: null }) as any);
    const r = await hub.resolve('orbiter', '0xh', {});
    expect(r.hop).toBe(hop);
    expect(orbiter.resolve).toHaveBeenCalled();
    expect(lifi.resolve).not.toHaveBeenCalled();
  });

  it('resolve returns null for an unknown bridge id', async () => {
    const hub = new BridgeHubService(adapter('orbiter', { hop }) as any, adapter('debridge', { hop }) as any, adapter('lifi', { hop }) as any, adapter('across', { hop }) as any);
    expect((await hub.resolve('nope', '0xh', {})).hop).toBeNull();
  });

  it('resolveAny returns the first adapter that finds a hop', async () => {
    const hub = new BridgeHubService(adapter('orbiter', { hop: null }) as any, adapter('debridge', { hop }) as any, adapter('lifi', { hop: null }) as any, adapter('across', { hop: null }) as any);
    expect((await hub.resolveAny('0xh', {})).hop).toBe(hop);
  });

  it('resolveAny preserves outOfRange when nothing matches', async () => {
    const hub = new BridgeHubService(adapter('orbiter', { hop: null, outOfRange: true }) as any, adapter('debridge', { hop: null }) as any, adapter('lifi', { hop: null }) as any, adapter('across', { hop: null }) as any);
    const r = await hub.resolveAny('0xh', {});
    expect(r.hop).toBeNull();
    expect(r.outOfRange).toBe(true);
  });
});
