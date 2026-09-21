import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Entity labels ("Binance Hot Wallet", "FixedFloat. User", …) from OKLink's
// official API — the same label database the OKX Web3 explorer shows. Scraping
// the explorer pages no longer works (they ship an empty `__INIT_STATE__` and
// load tags through a signed, encrypted POST), so this is the supported route.
// A free key: https://www.oklink.com/account/my-api → OKLINK_API_KEY.
const OKLINK = 'https://www.oklink.com/api/v5/explorer/address/entity-label';

// Our network id → OKLink `chainShortName`.
const CHAINS: Record<string, string> = {
  ETH: 'eth', BSC: 'bsc', POLYGON: 'polygon', ARBITRUM: 'arbitrum', BASE: 'base',
  TRON: 'tron', SOLANA: 'sol',
};

@Injectable()
export class OkLinkProvider {
  private readonly logger = new Logger(OkLinkProvider.name);
  private readonly key: () => string;
  // Labels barely change; a miss is re-checked sooner since it may just have
  // been a throttled request.
  private cache = new Map<string, { label: string | null; at: number }>();
  private static readonly HIT_TTL = 30 * 60_000;
  private static readonly MISS_TTL = 5 * 60_000;

  // OKLink's free tier throttles bursts, and a graph batch fans out one lookup
  // per wallet — keep a few in flight and queue the rest.
  private static readonly MAX_INFLIGHT = 3;
  private inflight = 0;
  private waiting: Array<() => void> = [];

  constructor(cfg: ConfigService) { this.key = () => cfg.get<string>('OKLINK_API_KEY', ''); }

  get enabled(): boolean { return !!this.key(); }

  private async acquire(): Promise<void> {
    if (this.inflight < OkLinkProvider.MAX_INFLIGHT) { this.inflight++; return; }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next(); else this.inflight--;
  }

  async fetchEntityLabel(network: string, address: string): Promise<string | null> {
    const chain = CHAINS[network];
    if (!chain || !this.enabled) return null;
    const ck = `${chain}:${address}`;
    const c = this.cache.get(ck);
    const ttl = c?.label ? OkLinkProvider.HIT_TTL : OkLinkProvider.MISS_TTL;
    if (c && Date.now() - c.at < ttl) return c.label;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    await this.acquire();
    try {
      const r = await fetch(`${OKLINK}?chainShortName=${chain}&address=${encodeURIComponent(address)}`, {
        headers: { 'Ok-Access-Key': this.key(), Accept: 'application/json' },
        signal: ac.signal,
      });
      if (r.status === 429) { this.logger.warn(`[OKLink] rate-limited on ${network} ${address}`); return null; }
      const j = await r.json() as { code?: string; msg?: string; data?: Array<Record<string, unknown>> };
      if (String(j.code) !== '0') {
        // A bad key / plan is a config problem, not a "no label" — say so once
        // per lookup rather than silently caching a miss.
        this.logger.warn(`[OKLink] ${network} ${address}: ${j.code} ${j.msg ?? ''}`);
        return null;
      }
      const row = j.data?.[0] ?? {};
      const raw = row['label'] ?? row['addressLabel'] ?? row['entityTag'] ?? '';
      const label = String(raw).trim() || null;
      this.cache.set(ck, { label, at: Date.now() });
      return label;
    } catch (e) {
      this.logger.warn(`[OKLink] ${network} ${address}: ${(e as Error)?.message}`);
      return null;
    } finally {
      clearTimeout(timer);
      this.release();
    }
  }
}
