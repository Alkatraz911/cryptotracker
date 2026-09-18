import { ConfigService } from '@nestjs/config';
import { TronProvider } from './tron.provider';

// TronScan drops parallel bursts (HTTP 429), which is how entity tags went
// missing on the graph while the transaction list still showed them. These pin
// the two defences: a concurrency gate, and a label cache that never caches a
// failed lookup as "no tag".
describe('TronProvider · address tags', () => {
  const cfg = { get: (_k: string, d: string) => d } as unknown as ConfigService;
  const ADDR = 'TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9';

  afterEach(() => { jest.restoreAllMocks(); });

  // Resolve each request on the next tick so overlapping calls are observable.
  const mockFetch = (body: Record<string, unknown>, onCall?: () => void) => {
    let inflight = 0;
    let peak = 0;
    global.fetch = jest.fn(async () => {
      onCall?.();
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight--;
      return { status: 200, ok: true, json: async () => body };
    }) as unknown as typeof fetch;
    return { peak: () => peak };
  };

  it('never runs more than two TronScan requests at once', async () => {
    const m = mockFetch({ addressTag: 'Binance-Hot 1' });
    const p = new TronProvider(cfg);

    const addrs = Array.from({ length: 12 }, (_, i) => `${ADDR}${i}`);
    const res = await Promise.all(addrs.map((a) => p.fetchAddressLabel(a)));

    expect(res.every((r) => r.label === 'Binance-Hot 1')).toBe(true);
    expect(m.peak()).toBeLessThanOrEqual(2);
  });

  it('serves a repeat lookup from cache', async () => {
    let calls = 0;
    mockFetch({ addressTag: 'HTX 1' }, () => { calls++; });
    const p = new TronProvider(cfg);

    await p.fetchAddressLabel(ADDR);
    const again = await p.fetchAddressLabel(ADDR);

    expect(again.label).toBe('HTX 1');
    expect(calls).toBe(1);
  });

  it('does not cache a failed lookup as "no tag"', async () => {
    // Every attempt rate-limited → the provider gives up with an empty body.
    global.fetch = jest.fn(async () => ({ status: 429, ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    const p = new TronProvider(cfg);
    expect((await p.fetchAddressLabel(ADDR)).label).toBeNull();

    // TronScan recovers — the next lookup must ask again, not replay the miss.
    global.fetch = jest.fn(async () => ({ status: 200, ok: true, json: async () => ({ addressTag: 'Bybit' }) })) as unknown as typeof fetch;
    expect((await p.fetchAddressLabel(ADDR)).label).toBe('Bybit');
  }, 30000);
});
