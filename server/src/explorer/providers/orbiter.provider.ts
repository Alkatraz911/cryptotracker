import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Orbiter Finance cross-chain bridge data.
// Primary source is the local orbiter-indexer service (ORBITER_INDEXER_URL):
// a DB mirror that answers instantly and covers all ingested history. When the
// indexer is unreachable (or a tx/window isn't ingested yet) we fall back to
// querying Orbiter's public API directly:
//   • resolve a single tx via the hash-lookup endpoint, then the feed, and
//   • import a chain-pair feed by jumping to the time window and paging it.

const ORBITER_BASE = 'https://openapi.orbiter.finance/partner-data-openness/transcations/list';
const PAGE_ROWS = 10; // fixed by the API

// chainId → display + explorer + RPC + our internal Network (or UNKNOWN).
interface ChainDef { name: string; net: string; rpc: string | null; tx: (h: string) => string; }
export const ORBITER_CHAINS: Record<string, ChainDef> = {
  '1':      { name: 'Ethereum',  net: 'ETH',      rpc: 'https://eth.llamarpc.com',       tx: (h) => `https://etherscan.io/tx/${h}` },
  '42161':  { name: 'Arbitrum',  net: 'ARBITRUM', rpc: 'https://arb1.arbitrum.io/rpc',   tx: (h) => `https://arbiscan.io/tx/${h}` },
  '8453':   { name: 'Base',      net: 'BASE',     rpc: 'https://mainnet.base.org',       tx: (h) => `https://basescan.org/tx/${h}` },
  '56':     { name: 'BSC',       net: 'BSC',      rpc: 'https://bsc-dataseed.binance.org', tx: (h) => `https://bscscan.com/tx/${h}` },
  '137':    { name: 'Polygon',   net: 'POLYGON',  rpc: 'https://polygon-rpc.com',        tx: (h) => `https://polygonscan.com/tx/${h}` },
  '10':     { name: 'Optimism',  net: 'UNKNOWN',  rpc: 'https://mainnet.optimism.io',    tx: (h) => `https://optimistic.etherscan.io/tx/${h}` },
  '59144':  { name: 'Linea',     net: 'UNKNOWN',  rpc: 'https://rpc.linea.build',        tx: (h) => `https://lineascan.build/tx/${h}` },
  '324':    { name: 'zkSync Era',net: 'UNKNOWN',  rpc: 'https://mainnet.era.zksync.io',  tx: (h) => `https://explorer.zksync.io/tx/${h}` },
  '534352': { name: 'Scroll',    net: 'UNKNOWN',  rpc: 'https://rpc.scroll.io',          tx: (h) => `https://scrollscan.com/tx/${h}` },
  '5000':   { name: 'Mantle',    net: 'UNKNOWN',  rpc: 'https://rpc.mantle.xyz',         tx: (h) => `https://explorer.mantle.xyz/tx/${h}` },
  // Non-EVM destinations Orbiter bridges to (their internal chain ids). Tron tx
  // ids come back without a 0x prefix; Tronscan accepts the bare hex.
  '728126428': { name: 'Tron',   net: 'TRON',     rpc: null, tx: (h) => `https://tronscan.org/#/transaction/${h}` },
  '501':       { name: 'Solana', net: 'SOLANA',   rpc: null, tx: (h) => `https://solscan.io/tx/${h}` },
};

export interface OrbiterRow {
  status: number;
  sourceId: string;
  targetId: string;
  sourceChain: string;
  targetChain: string;
  sourceAmount: string;
  sourceSymbol: string;
  sourceTime: string;        // ISO
  sourceAmountUSD: string;
}

export interface OrbiterHop {
  sourceId: string; targetId: string;
  sourceChain: string; targetChain: string;
  sourceChainName: string; targetChainName: string;
  sourceNet: string; targetNet: string;
  sourceTxUrl: string; targetTxUrl: string;
  amount: number; symbol: string; usd: number;
  sourceTime: number;        // ms
  sourceAddress?: string;    // sender wallet on the source chain (lookup only)
  targetWallet?: string;     // recipient wallet on the target chain (lookup only)
}

// Raw record from api.orbiter.finance/transaction/{hash} (covers ~6 months,
// indexed by hash directly, and uniquely includes wallet addresses).
interface OrbiterLookup {
  chainId: string; hash: string; sender: string; receiver: string;
  amount: string; symbol: string; timestamp: string;
  targetId: string; targetChain: string; targetAmount: string;
  targetSymbol: string; targetAddress: string;
}

// Row shape returned by the orbiter-indexer HTTP API (DB-backed).
interface IndexerBridge {
  sourceId: string; targetId: string | null;
  sourceChain: string; targetChain: string;
  sender: string | null; receiver: string | null; targetAddress: string | null;
  amount: number | null; symbol: string | null; usd: number | null;
  sourceTime: string;
}

@Injectable()
export class OrbiterProvider {
  private readonly logger = new Logger(OrbiterProvider.name);

  constructor(private readonly cfg: ConfigService) {}

  private indexerUrl(): string {
    return (this.cfg.get<string>('ORBITER_INDEXER_URL', '') || '').replace(/\/+$/, '');
  }

  chainName(chainId: string): string { return ORBITER_CHAINS[chainId]?.name ?? `chain ${chainId}`; }

  // ── orbiter-indexer (local DB) access ──────────────────────────────────────
  private async fetchIndexer<T>(path: string): Promise<T | null> {
    const base = this.indexerUrl();
    if (!base) return null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetch(`${base}${path}`, { signal: ac.signal });
      if (!r.ok) return null;
      return await r.json() as T;
    } catch (e) {
      this.logger.warn(`[Indexer] ${path} failed: ${(e as Error)?.message}`);
      return null;
    } finally { clearTimeout(timer); }
  }

  private indexerBridgeToHop(b: IndexerBridge): OrbiterHop {
    const s = ORBITER_CHAINS[b.sourceChain];
    const t = ORBITER_CHAINS[b.targetChain];
    return {
      sourceId: b.sourceId, targetId: b.targetId ?? '',
      sourceChain: b.sourceChain, targetChain: b.targetChain,
      sourceChainName: s?.name ?? `chain ${b.sourceChain}`,
      targetChainName: t?.name ?? `chain ${b.targetChain}`,
      sourceNet: s?.net ?? 'UNKNOWN', targetNet: t?.net ?? 'UNKNOWN',
      sourceTxUrl: s ? s.tx(b.sourceId) : '',
      targetTxUrl: t && b.targetId ? t.tx(b.targetId) : '',
      amount: Number(b.amount) || 0, symbol: b.symbol ?? '',
      usd: Number(b.usd) || 0, sourceTime: Date.parse(b.sourceTime),
      sourceAddress: b.sender ?? undefined, targetWallet: b.targetAddress ?? undefined,
    };
  }

  private toHop(r: OrbiterRow): OrbiterHop {
    const s = ORBITER_CHAINS[r.sourceChain];
    const t = ORBITER_CHAINS[r.targetChain];
    return {
      sourceId: r.sourceId, targetId: r.targetId,
      sourceChain: r.sourceChain, targetChain: r.targetChain,
      sourceChainName: s?.name ?? `chain ${r.sourceChain}`,
      targetChainName: t?.name ?? `chain ${r.targetChain}`,
      sourceNet: s?.net ?? 'UNKNOWN', targetNet: t?.net ?? 'UNKNOWN',
      sourceTxUrl: s ? s.tx(r.sourceId) : '', targetTxUrl: t ? t.tx(r.targetId) : '',
      amount: Number(r.sourceAmount) || 0, symbol: r.sourceSymbol,
      usd: Number(r.sourceAmountUSD) || 0, sourceTime: Date.parse(r.sourceTime),
    };
  }

  private lookupToHop(r: OrbiterLookup): OrbiterHop {
    const s = ORBITER_CHAINS[r.chainId];
    const t = ORBITER_CHAINS[r.targetChain];
    return {
      sourceId: r.hash, targetId: r.targetId,
      sourceChain: r.chainId, targetChain: r.targetChain,
      sourceChainName: s?.name ?? `chain ${r.chainId}`,
      targetChainName: t?.name ?? `chain ${r.targetChain}`,
      sourceNet: s?.net ?? 'UNKNOWN', targetNet: t?.net ?? 'UNKNOWN',
      sourceTxUrl: s ? s.tx(r.hash) : '', targetTxUrl: t ? t.tx(r.targetId) : '',
      amount: Number(r.amount) || 0, symbol: r.symbol,
      usd: 0, sourceTime: Date.parse(r.timestamp),
      sourceAddress: r.sender, targetWallet: r.targetAddress,
    };
  }

  // Direct hash lookup — O(1), returns both tx ids + wallet addresses, and
  // reaches deep history. Orbiter's SDK status endpoint is authoritative here
  // (the older /transaction/{hash} one returns null for many older bridges);
  // try it first, then fall back.
  private async lookupTx(hash: string): Promise<OrbiterLookup | null> {
    for (const url of [
      `https://api.orbiter.finance/sdk/transaction/status/${hash}`,
      `https://api.orbiter.finance/transaction/${hash}`,
    ]) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      try {
        const r = await fetch(url, { signal: ac.signal });
        if (r.ok) {
          const j = await r.json() as { result?: OrbiterLookup | null };
          if (j.result?.targetId) return j.result;
        }
      } catch { /* try the next endpoint */ }
      finally { clearTimeout(timer); }
    }
    return null;
  }

  // ── low-level page fetch ─────────────────────────────────────────────────
  // Deep pages (≈>20k) get slow and time out, so the feed is only practically
  // reachable for recent history; callers bound their page budget accordingly.
  private async fetchPage(params: Record<string, string | number>): Promise<OrbiterRow[]> {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 14000); // deep pages are slow but reachable
    try {
      const r = await fetch(`${ORBITER_BASE}?${qs}`, { signal: ac.signal });
      if (!r.ok) { this.logger.warn(`[Orbiter] HTTP ${r.status}`); return []; }
      const j = await r.json() as { errno: number; data?: { rows?: OrbiterRow[] } };
      if (j.errno !== 0) { this.logger.warn(`[Orbiter] errno ${j.errno}`); return []; }
      return j.data?.rows ?? [];
    } catch { return []; }
    finally { clearTimeout(timer); }
  }

  // ── block-time lookup (for binary search) ────────────────────────────────
  private async rpc(rpc: string, method: string, params: unknown[]): Promise<any> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    try {
      const r = await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ac.signal,
      });
      const j = await r.json() as { result?: unknown };
      return j.result ?? null;
    } catch { return null; } finally { clearTimeout(timer); }
  }

  async blockTime(chainId: string, hash: string): Promise<number | null> {
    const rpc = ORBITER_CHAINS[chainId]?.rpc;
    if (!rpc) return null;
    const tx = await this.rpc(rpc, 'eth_getTransactionByHash', [hash]) as { blockNumber?: string } | null;
    if (!tx?.blockNumber) return null;
    const blk = await this.rpc(rpc, 'eth_getBlockByNumber', [tx.blockNumber, false]) as { timestamp?: string } | null;
    if (!blk?.timestamp) return null;
    return parseInt(blk.timestamp, 16) * 1000;
  }

  // ── locate a page by time, then search/collect ───────────────────────────
  // The feed is ordered newest→oldest with a stable density, so any historical
  // page is reached by estimating from the timestamp + bracketed binary search
  // (a few requests) instead of paging sequentially. Pair feeds (source+target)
  // are sparse and reach far back; we cap MAX_PAGE generously and let deep
  // (slow) pages run — the jump keeps the request count low regardless of depth.
  private static readonly MAX_PAGE = 60000;
  private static readonly FETCH_BUDGET = 70;

  private static newest(r: OrbiterRow[]) { return r.length ? Date.parse(r[0].sourceTime) : NaN; }
  private static oldest(r: OrbiterRow[]) { return r.length ? Date.parse(r[r.length - 1].sourceTime) : NaN; }

  // Locate the page whose rows straddle targetMs. Uses interpolation search:
  // the feed's density is near-linear, so estimating the page from the time
  // fraction converges in ~5 requests even at page ~11000+ (binary search would
  // need ~14, and deep pages are slow — so fewer requests matters a lot).
  private async locatePage(
    get: (p: number) => Promise<OrbiterRow[]>, targetMs: number,
  ): Promise<{ center: number; outOfRange: boolean }> {
    const { newest, oldest } = OrbiterProvider;
    const first = await get(1);
    if (!first.length) return { center: 1, outOfRange: false };
    if (targetMs >= oldest(first)) return { center: 1, outOfRange: false };

    // Exponentially probe to bracket: lo = newer page, hi = first page older than target.
    let loPage = 1, loT = newest(first);
    let hiPage = 0, hiT = 0, bracketed = false;
    for (let p = 1000; ; p = Math.min(OrbiterProvider.MAX_PAGE, p * 4)) {
      const rows = await get(p);
      if (rows.length && newest(rows) <= targetMs) { hiPage = p; hiT = newest(rows); bracketed = true; break; }
      if (rows.length) { loPage = p; loT = newest(rows); }   // page p still newer than target
      if (p >= OrbiterProvider.MAX_PAGE) break;
    }
    if (!bracketed) return { center: OrbiterProvider.MAX_PAGE, outOfRange: true };

    // Interpolate the page from the time fraction between the bracket ends.
    let center = hiPage;
    for (let i = 0; i < 10 && hiPage - loPage > 2; i++) {
      const span = loT - hiT || 1;
      let mid = Math.round(loPage + ((loT - targetMs) / span) * (hiPage - loPage));
      mid = Math.max(loPage + 1, Math.min(hiPage - 1, mid));
      const rows = await get(mid);
      if (!rows.length) { hiPage = mid; continue; }           // empty (deep/slow) → treat as older bound
      const nt = newest(rows), ot = oldest(rows);
      if (ot <= targetMs && targetMs <= nt) return { center: mid, outOfRange: false };
      if (nt < targetMs) { hiPage = mid; hiT = nt; center = mid; }   // too old → tighten upper
      else { loPage = mid; loT = ot; center = mid; }                 // too new → tighten lower
    }
    return { center, outOfRange: false };
  }

  // A page-fetcher with its own cache + request budget. Empty results are
  // retried once — deep pages occasionally time out, and a transient empty must
  // not be mistaken for the end of the feed (which would truncate collection).
  private pageGetter(params: Record<string, string>, budget = OrbiterProvider.FETCH_BUDGET) {
    const cache = new Map<number, OrbiterRow[]>();
    const state = { budget };
    const get = async (p: number): Promise<OrbiterRow[]> => {
      const pg = Math.max(1, Math.min(OrbiterProvider.MAX_PAGE, Math.round(p)));
      if (cache.has(pg)) return cache.get(pg)!;
      if (state.budget-- <= 0) return [];
      let rows = await this.fetchPage({ page: pg, ...params });
      if (!rows.length && state.budget-- > 0) rows = await this.fetchPage({ page: pg, ...params });
      cache.set(pg, rows);
      return rows;
    };
    return { get, state };
  }

  // Find a hash in a feed defined by `params`, near targetMs.
  private async searchFeed(
    params: Record<string, string>, matchKey: 'sourceId' | 'targetId', hash: string, targetMs: number,
  ): Promise<{ row: OrbiterRow | null; outOfRange: boolean }> {
    const { get, state } = this.pageGetter(params);
    const want = hash.toLowerCase();
    const find = (r: OrbiterRow[]) => r.find((x) => x[matchKey]?.toLowerCase() === want) ?? null;

    const { center, outOfRange } = await this.locatePage(get, targetMs);
    if (outOfRange) return { row: null, outOfRange: true };

    for (let d = 0; d <= 6 && state.budget > 0; d++) {
      for (const p of d === 0 ? [center] : [center - d, center + d]) {
        if (p < 1) continue;
        const hit = find(await get(p));
        if (hit) return { row: hit, outOfRange: false };
      }
    }
    return { row: null, outOfRange: false };
  }

  // Resolve a tx hash to its cross-chain counterpart.
  // Strategy: direct hash lookup first (instant, with addresses, ~6 months) —
  // works by hash alone (chainId optional). For older txs, fall back to a
  // time-seeded search of the (sparser, deeper-reachable) feed.
  // Returns { hop, outOfRange } — outOfRange means the tx predates Orbiter's
  // reachable history, so a null is "too old", not "not a bridge".
  async resolve(hash: string, chainId?: string, tsMs?: number, fast = false): Promise<{ hop: OrbiterHop | null; outOfRange: boolean }> {
    // 0) Local indexer first — instant, full ingested history, with addresses.
    const idx = await this.fetchIndexer<{ bridge: IndexerBridge | null }>(`/bridges/tx/${hash}`);
    if (idx?.bridge) {
      this.logger.log(`[Orbiter] indexer hit → ${idx.bridge.targetChain}`);
      return { hop: this.indexerBridgeToHop(idx.bridge), outOfRange: false };
    }

    // 1) Direct lookup — covers the bulk of cases, no chain needed.
    const direct = await this.lookupTx(hash);
    if (direct) {
      this.logger.log(`[Orbiter] lookup match → ${direct.targetChain}`);
      return { hop: this.lookupToHop(direct), outOfRange: false };
    }

    // Fast mode (used by auto-trace on many hashes): skip the slow feed search —
    // a non-bridge tx would otherwise trigger an expensive multi-feed crawl.
    if (fast) return { hop: null, outOfRange: false };

    // 2) Feed fallback (needs the source chain to query).
    if (!chainId) {
      this.logger.log(`[Orbiter] lookup miss, no chainId for feed fallback (${hash.slice(0, 12)}…)`);
      return { hop: null, outOfRange: false };
    }
    const targetMs = tsMs && tsMs > 0 ? tsMs : (await this.blockTime(chainId, hash)) ?? Date.now();
    this.logger.log(`[Orbiter] feed fallback ${hash.slice(0, 12)}… chain=${chainId} t=${new Date(targetMs).toISOString()}`);

    // Pair feeds (source+target) are sparse and reach deep history. Search every
    // candidate counterpart chain in parallel — forward (chainId→other, match
    // sourceId) and reverse (other→chainId, match targetId). Also the dense
    // sourceChain/targetChain-only feeds for the recent range.
    const others = Object.keys(ORBITER_CHAINS).filter((c) => c !== chainId);
    const searches: Promise<{ row: OrbiterRow | null; outOfRange: boolean }>[] = [
      this.searchFeed({ sourceChain: chainId }, 'sourceId', hash, targetMs),
      this.searchFeed({ targetChain: chainId }, 'targetId', hash, targetMs),
      ...others.flatMap((o) => [
        this.searchFeed({ sourceChain: chainId, targetChain: o }, 'sourceId', hash, targetMs),
        this.searchFeed({ sourceChain: o, targetChain: chainId }, 'targetId', hash, targetMs),
      ]),
    ];
    const results = await Promise.all(searches);
    const hit = results.find((r) => r.row);
    if (hit?.row) { this.logger.log(`[Orbiter] feed match → ${hit.row.targetChain}`); return { hop: this.toHop(hit.row), outOfRange: false }; }

    const outOfRange = results.some((r) => r.outOfRange);
    this.logger.log(`[Orbiter] no match for ${hash.slice(0, 12)}…${outOfRange ? ' (out of reachable range)' : ''}`);
    return { hop: null, outOfRange };
  }

  // ── feed import (time-window, jump-to-page) ──────────────────────────────
  // Jumps directly to the page for `untilMs` (newest edge of the window) via the
  // time estimate, then collects older rows until `sinceMs` or the limit. This
  // makes any historical window reachable without paging from page 1.
  async feed(opts: {
    sourceChain: string; targetChain?: string; minUsd?: number;
    sinceMs?: number; untilMs?: number; limit?: number;
  }): Promise<{ hops: OrbiterHop[]; diag: string | null }> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const minUsd = opts.minUsd ?? 0;
    const sinceMs = opts.sinceMs ?? 0;
    const untilMs = opts.untilMs ?? 0;

    // 0) Local indexer first. Use its result when it returns anything; only fall
    // through to the live feed when it's unreachable or has nothing for the window.
    if (this.indexerUrl()) {
      const qp = new URLSearchParams({ source: opts.sourceChain, limit: String(limit) });
      if (opts.targetChain) qp.set('target', opts.targetChain);
      if (minUsd) qp.set('minUsd', String(minUsd));
      if (sinceMs) qp.set('from', new Date(sinceMs).toISOString());
      if (untilMs) qp.set('to', new Date(untilMs).toISOString());
      const idx = await this.fetchIndexer<{ bridges: IndexerBridge[] }>(`/bridges?${qp.toString()}`);
      if (idx?.bridges?.length) {
        this.logger.log(`[Orbiter] indexer feed: ${idx.bridges.length} hops`);
        return { hops: idx.bridges.map((b) => this.indexerBridgeToHop(b)), diag: null };
      }
    }

    const params: Record<string, string> = { sourceChain: opts.sourceChain };
    if (opts.targetChain) params.targetChain = opts.targetChain;

    const { get, state } = this.pageGetter(params, 1200); // allow deep, wide windows
    let startPage = 1;
    let outOfRange = false;
    if (untilMs) {
      const loc = await this.locatePage(get, untilMs);
      startPage = loc.center;
      outOfRange = loc.outOfRange;
    }

    // Collect forward (older) in PARALLEL batches — a deep window can span
    // hundreds of pages and serial fetching of slow deep pages is the bottleneck.
    const out: OrbiterHop[] = [];
    const BATCH = 10;
    let page = startPage;
    let pastWindow = false;
    while (!pastWindow && state.budget > 0) {
      const batchPages = Array.from({ length: BATCH }, (_, i) => page + i);
      page += BATCH;
      const batch = await Promise.all(batchPages.map((p) => get(p)));
      for (const rows of batch) {            // batch is in ascending page = chronological order
        if (!rows.length) { pastWindow = true; break; }
        for (const r of rows) {
          const t = Date.parse(r.sourceTime);
          if (untilMs && t > untilMs) continue;            // newer than window
          if (sinceMs && t < sinceMs) { pastWindow = true; break; }
          if (opts.targetChain && r.targetChain !== opts.targetChain) continue;
          if ((Number(r.sourceAmountUSD) || 0) < minUsd) continue;
          out.push(this.toHop(r));
          if (out.length >= limit) { pastWindow = true; break; }
        }
        if (pastWindow) break;
        if (rows.length < PAGE_ROWS) { pastWindow = true; break; }
      }
    }

    const diag = out.length ? null
      : outOfRange ? 'Orbiter: период старше доступной глубины фида'
      : 'Orbiter: подходящих переводов не найдено (проверьте сети/фильтры/период)';
    return { hops: out, diag };
  }
}
