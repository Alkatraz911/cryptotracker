import { ConfigService } from '@nestjs/config';
import { EvmProvider } from './evm.provider';

// BSC goes through NodeReal's nr_getAssetTransfers (BscScan is Cloudflare-blocked).
// These cover the mapping rules the scraper used to enforce: value-less contract
// calls are not transfers, token amounts respect the contract's decimals, and the
// same movement seen from both endpoints is reported once.
describe('EvmProvider · BSC via NodeReal', () => {
  const cfg = { get: (k: string, d: string) => (k === 'ETHERSCAN_API_KEY' ? '' : d) } as unknown as ConfigService;
  const ADDR = '0x1111111111111111111111111111111111111111';
  const OTHER = '0x2222222222222222222222222222222222222222';

  const row = (over: Record<string, unknown>) => ({
    category: 'external', from: ADDR, to: OTHER, value: '0x0de0b6b3a7640000',
    asset: 'BNB', hash: '0xaa', blockTimeStamp: 1700000000, ...over,
  });

  // Answer each nr_getAssetTransfers call by (category, direction).
  const mockFetch = (byQuery: (cat: string, dir: string) => Record<string, unknown>[]) => {
    global.fetch = jest.fn(async (_url: unknown, init: { body: string }) => {
      const p = JSON.parse(init.body).params[0];
      const dir = p.fromAddress ? 'from' : 'to';
      return { status: 200, ok: true, json: async () => ({ result: { transfers: byQuery(p.category[0], dir) } }) };
    }) as unknown as typeof fetch;
  };

  afterEach(() => { jest.restoreAllMocks(); });

  it('maps native + token rows, honouring token decimals', async () => {
    mockFetch((cat, dir) => {
      if (dir !== 'from') return [];
      if (cat === 'external') return [row({})];
      return [row({
        category: '20', hash: '0xbb', asset: 'USDT', decimal: '18',
        value: '0x1bc16d674ec80000', contractAddress: '0x55d3',
      })];
    });

    const p = new EvmProvider(cfg);
    const res = await p.fetchWalletTransfers('BSC', ADDR, { native: true, token: true, limit: 50 });

    expect(res.status).toBe('ok');
    expect(res.source).toBe('nodereal:bsc');
    expect(res.transfers).toEqual([
      { network: 'BSC', hash: '0xaa', from: ADDR, to: OTHER, amount: 1, asset: 'BNB', timestamp: 1700000000000 },
      { network: 'BSC', hash: '0xbb', from: ADDR, to: OTHER, amount: 2, asset: 'USDT', timestamp: 1700000000000 },
    ]);
  });

  it('drops value-less native rows (plain contract calls)', async () => {
    mockFetch((cat, dir) => (cat === 'external' && dir === 'from' ? [row({ value: '0x0' })] : []));

    const p = new EvmProvider(cfg);
    const res = await p.fetchWalletTransfers('BSC', ADDR, { native: true, token: false, limit: 50 });

    expect(res.transfers).toHaveLength(0);
    expect(res.status).toBe('empty');
  });

  it('reports the same movement once when both endpoints are the wallet', async () => {
    mockFetch((cat) => (cat === 'external' ? [row({ to: ADDR })] : []));

    const p = new EvmProvider(cfg);
    const res = await p.fetchWalletTransfers('BSC', ADDR, { native: true, token: false, limit: 50 });

    expect(res.transfers).toHaveLength(1);
  });

  it('sizes the page to the requested limit', async () => {
    const asked: number[] = [];
    global.fetch = jest.fn(async (_url: unknown, init: { body: string }) => {
      asked.push(parseInt(JSON.parse(init.body).params[0].maxCount, 16));
      return { status: 200, ok: true, json: async () => ({ result: { transfers: [row({})] } }) };
    }) as unknown as typeof fetch;

    const p = new EvmProvider(cfg);
    await p.fetchWalletTransfers('BSC', ADDR, { native: true, token: false, limit: 25 });
    await p.fetchWalletTransfers('BSC', ADDR, { native: true, token: false, limit: 2000 });

    expect(asked[0]).toBe(100);   // a trace-sized request doesn't pull 1000 rows
    expect(Math.max(...asked)).toBe(1000); // the full-history request still does
  });

  it('points at the free-key fix when the shared endpoint throttles us', () => {
    // Reaching the mapping directly — a real 429 run spends its backoff budget.
    const diag = (p: EvmProvider, err: string) => (p as unknown as { nodeRealDiag: (e: string) => string }).nodeRealDiag(err);

    const shared = new EvmProvider(cfg);
    expect(diag(shared, 'HTTP 429')).toMatch(/NODEREAL_API_KEY/);
    expect(diag(shared, 'HTTP 500')).not.toMatch(/NODEREAL_API_KEY/);

    const own = new EvmProvider({ get: (k: string, d: string) => (k === 'NODEREAL_API_KEY' ? 'own-key' : d) } as unknown as ConfigService);
    expect(diag(own, 'HTTP 429')).toMatch(/лимит ключа/);
  });

  // Retries + the scraper fallback make this slower than the 5s default.
  it('surfaces a NodeReal outage as down (so the health banner fires)', async () => {
    global.fetch = jest.fn(async () => ({ status: 500, ok: false, json: async () => ({}) })) as unknown as typeof fetch;

    const p = new EvmProvider(cfg);
    const res = await p.fetchWalletTransfers('BSC', ADDR, { native: true, token: true, limit: 50 });

    expect(res.status).toBe('down');
    expect(res.diag).toMatch(/NodeReal/);
  }, 30000);
});
