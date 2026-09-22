import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Arkham Intelligence — entity attribution for addresses ("FixedFloat: Deposit",
// "Binance: Hot Wallet") across 20+ chains incl. TRON/Solana. Official API:
// https://arkm.com/api (free trial = 100k credits; a lookup costs 1 credit).
// Set ARKHAM_API_KEY; without it the provider is silently off.
const ARKHAM = 'https://api.arkm.com';

export interface ArkhamHit {
  label: string;                 // "Entity: Label" / "Entity" / "Label"
  entity: string | null;         // arkhamEntity.name
  entityType: string | null;     // cex, dex, bridge, mixer, fund, …
  detail: string | null;         // arkhamLabel.name
  chain: string | null;
}

@Injectable()
export class ArkhamProvider {
  private readonly logger = new Logger(ArkhamProvider.name);
  private readonly key: () => string;
  // Hits go to the shared label registry (DB), so this cache mostly protects
  // credits from repeat MISSES within one process (a miss costs 1 credit too).
  private cache = new Map<string, { hit: ArkhamHit | null; at: number }>();
  private static readonly HIT_TTL = 30 * 60_000;
  private static readonly MISS_TTL = 6 * 3600_000;
  // Standard endpoints allow 100 rps; keep a modest ceiling anyway.
  private static readonly MAX_INFLIGHT = 5;
  private inflight = 0;
  private waiting: Array<() => void> = [];
  // After an auth/quota rejection stop spending calls until the process restarts
  // or the key changes — every one of them would fail the same way.
  private disabledKey: string | null = null;

  constructor(cfg: ConfigService) { this.key = () => cfg.get<string>('ARKHAM_API_KEY', '').trim(); }

  get enabled(): boolean { const k = this.key(); return !!k && k !== this.disabledKey; }

  private async acquire(): Promise<void> {
    if (this.inflight < ArkhamProvider.MAX_INFLIGHT) { this.inflight++; return; }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  private release(): void {
    const next = this.waiting.shift();
    if (next) next(); else this.inflight--;
  }

  // Compose the display label the way Arkham's UI does: entity, then the
  // address-level label ("FixedFloat" + "Deposit" → "FixedFloat: Deposit").
  static compose(j: Record<string, any>): ArkhamHit | null {
    const entity = (j?.arkhamEntity?.name as string | undefined)?.trim() || null;
    const detail = (j?.arkhamLabel?.name as string | undefined)?.trim() || null;
    if (!entity && !detail) return null;
    const label = entity && detail && !detail.toLowerCase().startsWith(entity.toLowerCase()) ? `${entity}: ${detail}` : (detail && !entity ? detail : (entity as string));
    return { label, entity, entityType: (j?.arkhamEntity?.type as string | undefined) ?? null, detail, chain: (j?.chain as string | undefined) ?? null };
  }

  // `chain` is left out on purpose: Arkham then picks the best-matching chain
  // itself, which is what we want for chain-agnostic EVM addresses.
  async fetchLabel(address: string): Promise<ArkhamHit | null> {
    if (!this.enabled) return null;
    const c = this.cache.get(address);
    const ttl = c?.hit ? ArkhamProvider.HIT_TTL : ArkhamProvider.MISS_TTL;
    if (c && Date.now() - c.at < ttl) return c.hit;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    await this.acquire();
    try {
      const r = await fetch(`${ARKHAM}/intelligence/address/${encodeURIComponent(address)}`, {
        headers: { 'API-Key': this.key(), Accept: 'application/json' },
        signal: ac.signal,
      });
      if (r.status === 401 || r.status === 403 || r.status === 402) {
        this.disabledKey = this.key();
        this.logger.error(`[Arkham] key rejected (HTTP ${r.status}) — lookups disabled until the key changes`);
        return null;
      }
      if (r.status === 429) { this.logger.warn(`[Arkham] rate-limited on ${address}`); return null; }
      if (r.status === 404) { this.cache.set(address, { hit: null, at: Date.now() }); return null; }
      if (!r.ok) { this.logger.warn(`[Arkham] HTTP ${r.status} for ${address}`); return null; }
      const hit = ArkhamProvider.compose(await r.json() as Record<string, unknown>);
      this.cache.set(address, { hit, at: Date.now() });
      return hit;
    } catch (e) {
      this.logger.warn(`[Arkham] ${address}: ${(e as Error)?.message}`);
      return null;
    } finally {
      clearTimeout(timer);
      this.release();
    }
  }
}
