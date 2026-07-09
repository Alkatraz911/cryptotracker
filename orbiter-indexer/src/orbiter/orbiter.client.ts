import { Injectable, Logger } from '@nestjs/common';

// Low-level access to Orbiter's public endpoints. Two sources:
//   • feed  https://openapi.orbiter.finance/partner-data-openness/transcations/list
//           bulk dump, 10 rows/page, newest→oldest, no filtering, no addresses.
//   • lookup https://api.orbiter.finance/transaction/{hash}
//           O(1) by hash, includes wallet addresses, covers ~6 months.
const FEED_URL = 'https://openapi.orbiter.finance/partner-data-openness/transcations/list';
const LOOKUP_URL = 'https://api.orbiter.finance/transaction';
const PAGE_ROWS = 10;
const MAX_PAGE = 60000;

export interface ChainDef { name: string; net: string; rpc: string | null; tx: (h: string) => string; }
export const ORBITER_CHAINS: Record<string, ChainDef> = {
  '1':      { name: 'Ethereum',   net: 'ETH',      rpc: 'https://eth.llamarpc.com',       tx: (h) => `https://etherscan.io/tx/${h}` },
  '42161':  { name: 'Arbitrum',   net: 'ARBITRUM', rpc: 'https://arb1.arbitrum.io/rpc',   tx: (h) => `https://arbiscan.io/tx/${h}` },
  '8453':   { name: 'Base',       net: 'BASE',     rpc: 'https://mainnet.base.org',       tx: (h) => `https://basescan.org/tx/${h}` },
  '56':     { name: 'BSC',        net: 'BSC',      rpc: 'https://bsc-dataseed.binance.org', tx: (h) => `https://bscscan.com/tx/${h}` },
  '137':    { name: 'Polygon',    net: 'POLYGON',  rpc: 'https://polygon-rpc.com',        tx: (h) => `https://polygonscan.com/tx/${h}` },
  '10':     { name: 'Optimism',   net: 'UNKNOWN',  rpc: 'https://mainnet.optimism.io',    tx: (h) => `https://optimistic.etherscan.io/tx/${h}` },
  '59144':  { name: 'Linea',      net: 'UNKNOWN',  rpc: 'https://rpc.linea.build',        tx: (h) => `https://lineascan.build/tx/${h}` },
  '324':    { name: 'zkSync Era', net: 'UNKNOWN',  rpc: 'https://mainnet.era.zksync.io',  tx: (h) => `https://explorer.zksync.io/tx/${h}` },
  '534352': { name: 'Scroll',     net: 'UNKNOWN',  rpc: 'https://rpc.scroll.io',          tx: (h) => `https://scrollscan.com/tx/${h}` },
  '5000':   { name: 'Mantle',     net: 'UNKNOWN',  rpc: 'https://rpc.mantle.xyz',         tx: (h) => `https://explorer.mantle.xyz/tx/${h}` },
};
export const ORBITER_CHAIN_IDS = Object.keys(ORBITER_CHAINS);

export interface OrbiterRow {
  status: number;
  sourceId: string; targetId: string;
  sourceChain: string; targetChain: string;
  sourceAmount: string; sourceSymbol: string;
  sourceTime: string; sourceAmountUSD: string;
}

export interface OrbiterLookup {
  chainId: string; hash: string; sender: string; receiver: string;
  amount: string; symbol: string; timestamp: string;
  targetId: string; targetChain: string; targetAmount: string;
  targetSymbol: string; targetAddress: string;
}

@Injectable()
export class OrbiterClient {
  private readonly logger = new Logger(OrbiterClient.name);

  private static newest(r: OrbiterRow[]) { return r.length ? Date.parse(r[0].sourceTime) : NaN; }
  private static oldest(r: OrbiterRow[]) { return r.length ? Date.parse(r[r.length - 1].sourceTime) : NaN; }

  // ── single feed page ──────────────────────────────────────────────────────
  async fetchPage(params: Record<string, string | number>): Promise<OrbiterRow[]> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const ac = new AbortController();
    // Deep pages (page ~15k+) are slow but reachable — give them generous time.
    const timer = setTimeout(() => ac.abort(), 25000);
    try {
      const r = await fetch(`${FEED_URL}?${qs}`, { signal: ac.signal });
      if (!r.ok) return [];
      const j = (await r.json()) as { errno: number; data?: { rows?: OrbiterRow[] } };
      return j.errno === 0 ? j.data?.rows ?? [] : [];
    } catch { return []; }
    finally { clearTimeout(timer); }
  }

  // ── hash lookup (with addresses) ──────────────────────────────────────────
  async lookupTx(hash: string): Promise<OrbiterLookup | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetch(`${LOOKUP_URL}/${hash}`, { signal: ac.signal });
      if (!r.ok) return null;
      const j = (await r.json()) as { result?: OrbiterLookup | null };
      return j.result?.targetId ? j.result : null;
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  // A page-fetcher with cache + request budget; empty results retried once.
  private pageGetter(params: Record<string, string>, budget: number) {
    const cache = new Map<number, OrbiterRow[]>();
    const state = { budget };
    const get = async (p: number): Promise<OrbiterRow[]> => {
      const pg = Math.max(1, Math.min(MAX_PAGE, Math.round(p)));
      if (cache.has(pg)) return cache.get(pg)!;
      if (state.budget-- <= 0) return [];
      let rows = await this.fetchPage({ page: pg, ...params });
      if (!rows.length && state.budget-- > 0) rows = await this.fetchPage({ page: pg, ...params });
      cache.set(pg, rows);
      return rows;
    };
    return { get, state };
  }

  // Locate the page whose rows straddle targetMs via interpolation search
  // (feed density is near-linear → ~5-12 requests even at page ~11000+).
  private async locatePage(
    get: (p: number) => Promise<OrbiterRow[]>, targetMs: number,
  ): Promise<{ center: number; outOfRange: boolean }> {
    const { newest, oldest } = OrbiterClient;
    const first = await get(1);
    if (!first.length) return { center: 1, outOfRange: false };
    if (targetMs >= oldest(first)) return { center: 1, outOfRange: false };

    let loPage = 1, loT = newest(first);
    let hiPage = 0, hiT = 0, bracketed = false;
    for (let p = 1000; ; p = Math.min(MAX_PAGE, p * 4)) {
      const rows = await get(p);
      if (rows.length && newest(rows) <= targetMs) { hiPage = p; hiT = newest(rows); bracketed = true; break; }
      if (rows.length) { loPage = p; loT = newest(rows); }
      if (p >= MAX_PAGE) break;
    }
    if (!bracketed) return { center: MAX_PAGE, outOfRange: true };

    let center = hiPage;
    for (let i = 0; i < 10 && hiPage - loPage > 2; i++) {
      const span = loT - hiT || 1;
      let mid = Math.round(loPage + ((loT - targetMs) / span) * (hiPage - loPage));
      mid = Math.max(loPage + 1, Math.min(hiPage - 1, mid));
      const rows = await get(mid);
      if (!rows.length) { hiPage = mid; continue; }
      const nt = newest(rows), ot = oldest(rows);
      if (ot <= targetMs && targetMs <= nt) return { center: mid, outOfRange: false };
      if (nt < targetMs) { hiPage = mid; hiT = nt; center = mid; }
      else { loPage = mid; loT = ot; center = mid; }
    }
    return { center, outOfRange: false };
  }

  // Collect rows in [sinceMs, untilMs] for a feed defined by params, jumping to
  // the start page then reading forward in PARALLEL batches (deep windows span
  // hundreds of slow pages — serial reads are the bottleneck).
  async collectWindow(opts: {
    sourceChain: string; targetChain?: string;
    sinceMs: number; untilMs: number;
    maxRows?: number; budget?: number; batch?: number;
  }): Promise<{ rows: OrbiterRow[]; outOfRange: boolean }> {
    const params: Record<string, string> = { sourceChain: opts.sourceChain };
    if (opts.targetChain) params.targetChain = opts.targetChain;
    const maxRows = opts.maxRows ?? 5000;
    const batch = opts.batch ?? 10;
    const { get, state } = this.pageGetter(params, opts.budget ?? 2000);

    const loc = await this.locatePage(get, opts.untilMs);
    const out: OrbiterRow[] = [];
    let page = loc.center;
    let done = false;
    while (!done && state.budget > 0) {
      const pages = Array.from({ length: batch }, (_, i) => page + i);
      page += batch;
      const results = await Promise.all(pages.map((p) => get(p)));
      for (const rows of results) {
        if (!rows.length) { done = true; break; }
        for (const r of rows) {
          const t = Date.parse(r.sourceTime);
          if (t > opts.untilMs) continue;
          if (t < opts.sinceMs) { done = true; break; }
          out.push(r);
          if (out.length >= maxRows) { done = true; break; }
        }
        if (done) break;
        if (rows.length < PAGE_ROWS) { done = true; break; }
      }
    }
    return { rows: out, outOfRange: loc.outOfRange };
  }
}
