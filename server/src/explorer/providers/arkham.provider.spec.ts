import { ConfigService } from '@nestjs/config';
import { ArkhamProvider } from './arkham.provider';

const cfg = (key: string) => ({ get: (_k: string, d: string) => key || d } as unknown as ConfigService);
const reply = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body });
const TRON = 'TLXZxKcduSDxXQynpoCatnY5S4ET9SNACP';

describe('ArkhamProvider', () => {
  const fetchMock = jest.fn();
  beforeEach(() => { fetchMock.mockReset(); (global as unknown as { fetch: unknown }).fetch = fetchMock; });

  it('composes "Entity: Label" like the Arkham UI, and handles entity-only / label-only', () => {
    expect(ArkhamProvider.compose({ arkhamEntity: { name: 'FixedFloat', type: 'dex' }, arkhamLabel: { name: 'Deposit' }, chain: 'tron' }))
      .toMatchObject({ label: 'FixedFloat: Deposit', entity: 'FixedFloat', entityType: 'dex', detail: 'Deposit', chain: 'tron' });
    expect(ArkhamProvider.compose({ arkhamEntity: { name: 'Binance' }, arkhamLabel: null })?.label).toBe('Binance');
    expect(ArkhamProvider.compose({ arkhamEntity: null, arkhamLabel: { name: 'MEV Bot' } })?.label).toBe('MEV Bot');
    // a label that already starts with the entity name isn't doubled
    expect(ArkhamProvider.compose({ arkhamEntity: { name: 'Bybit' }, arkhamLabel: { name: 'Bybit Hot Wallet' } })?.label).toBe('Bybit');
    expect(ArkhamProvider.compose({ arkhamEntity: null, arkhamLabel: null, contract: false })).toBeNull();
  });

  it('is off without a key — no network call', async () => {
    const p = new ArkhamProvider(cfg(''));
    expect(p.enabled).toBe(false);
    expect(await p.fetchLabel(TRON)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the API-Key header without a chain filter and returns the composed hit', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { address: TRON, arkhamEntity: { name: 'FixedFloat', type: 'dex' }, arkhamLabel: { name: 'Deposit' }, chain: 'tron' }));
    const p = new ArkhamProvider(cfg('k1'));
    const hit = await p.fetchLabel(TRON);
    expect(hit?.label).toBe('FixedFloat: Deposit');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`https://api.arkm.com/intelligence/address/${TRON}`);
    expect((init as RequestInit).headers).toMatchObject({ 'API-Key': 'k1' });
  });

  it('caches misses so a repeat lookup costs no credit', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { address: TRON, arkhamEntity: null, arkhamLabel: null }));
    const p = new ArkhamProvider(cfg('k1'));
    expect(await p.fetchLabel(TRON)).toBeNull();
    expect(await p.fetchLabel(TRON)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a rejected key disables further lookups instead of failing every one', async () => {
    fetchMock.mockResolvedValueOnce(reply(401));
    const p = new ArkhamProvider(cfg('bad'));
    expect(await p.fetchLabel(TRON)).toBeNull();
    expect(p.enabled).toBe(false);
    expect(await p.fetchLabel('0x1111111111111111111111111111111111111111')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a 429 is not cached as a miss', async () => {
    fetchMock.mockResolvedValueOnce(reply(429)).mockResolvedValueOnce(reply(200, { arkhamEntity: { name: 'Bybit' } }));
    const p = new ArkhamProvider(cfg('k1'));
    expect(await p.fetchLabel(TRON)).toBeNull();
    expect((await p.fetchLabel(TRON))?.label).toBe('Bybit');
  });
});
