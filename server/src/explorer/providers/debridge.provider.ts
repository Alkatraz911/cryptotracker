import { Injectable, Logger } from '@nestjs/common';
import type { OrbiterHop } from './orbiter.provider';

// deBridge (DLN) cross-chain order data via the public stats API that powers
// app.debridge.com/orders. Orders are listed newest-first with skip/take
// pagination (no server-side time filter); a tx hash maps to order id(s), and
// each order's detail carries sender/receiver + both src/dst tx hashes.
//   • list:   POST stats-api.dln.trade/api/Orders/filteredList
//   • byHash: GET  stats-api.dln.trade/api/Transaction/{hash}/orderIds
//   • detail: GET  stats-api.dln.trade/api/Orders/{orderId}
const DLN_BASE = 'https://stats-api.dln.trade/api';
const ORDER_STATES = ['Fulfilled', 'SentUnlock', 'ClaimedUnlock'];

interface ChainDef { name: string; net: string; tx: (h: string) => string; }
export const DEBRIDGE_CHAINS: Record<string, ChainDef> = {
  '1':        { name: 'Ethereum',  net: 'ETH',      tx: (h) => `https://etherscan.io/tx/${h}` },
  '56':       { name: 'BSC',       net: 'BSC',      tx: (h) => `https://bscscan.com/tx/${h}` },
  '137':      { name: 'Polygon',   net: 'POLYGON',  tx: (h) => `https://polygonscan.com/tx/${h}` },
  '42161':    { name: 'Arbitrum',  net: 'ARBITRUM', tx: (h) => `https://arbiscan.io/tx/${h}` },
  '8453':     { name: 'Base',      net: 'BASE',     tx: (h) => `https://basescan.org/tx/${h}` },
  '10':       { name: 'Optimism',  net: 'UNKNOWN',  tx: (h) => `https://optimistic.etherscan.io/tx/${h}` },
  '43114':    { name: 'Avalanche', net: 'UNKNOWN',  tx: (h) => `https://snowtrace.io/tx/${h}` },
  '59144':    { name: 'Linea',     net: 'UNKNOWN',  tx: (h) => `https://lineascan.build/tx/${h}` },
  '100':      { name: 'Gnosis',    net: 'UNKNOWN',  tx: (h) => `https://gnosisscan.io/tx/${h}` },
  '146':      { name: 'Sonic',     net: 'UNKNOWN',  tx: (h) => `https://sonicscan.org/tx/${h}` },
  '7565164':  { name: 'Solana',    net: 'SOLANA',   tx: (h) => `https://solscan.io/tx/${h}` },
};
// Our Network → deBridge chainId (for filteredList chain filters).
export const NET_TO_DEBRIDGE: Record<string, string> = {
  ETH: '1', BSC: '56', POLYGON: '137', ARBITRUM: '42161', BASE: '8453', SOLANA: '7565164',
};

// deBridge wraps scalars as {stringValue,...}; pull the string out.
type Scalar = { stringValue?: string | null } | string | null | undefined;
const sv = (x: Scalar): string | null => (x == null ? null : typeof x === 'string' ? x : x.stringValue ?? null);

interface DlnOffer {
  chainId?: Scalar; tokenAddress?: Scalar; amount?: Scalar;
  decimals?: number; symbol?: string;
}
interface DlnEventMeta { transactionHash?: Scalar; blockTimeStamp?: number; }
interface DlnOrder {
  orderId?: Scalar;
  creationTimestamp?: number;
  giveOfferWithMetadata?: DlnOffer;
  takeOfferWithMetadata?: DlnOffer;
  makerSrc?: Scalar; receiverDst?: Scalar;
  createEventTransactionHash?: Scalar;
  createdSrcEventMetadata?: DlnEventMeta;
  fulfilledDstEventMetadata?: DlnEventMeta;
  state?: string;
}

@Injectable()
export class DebridgeProvider {
  private readonly logger = new Logger(DebridgeProvider.name);

  chainName(id: string): string { return DEBRIDGE_CHAINS[id]?.name ?? `chain ${id}`; }

  private async getJson<T>(path: string): Promise<T | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(`${DLN_BASE}${path}`, { signal: ac.signal });
      return r.ok ? (await r.json()) as T : null;
    } catch (e) { this.logger.warn(`GET ${path}: ${(e as Error)?.message}`); return null; }
    finally { clearTimeout(timer); }
  }

  private async postJson<T>(path: string, body: unknown): Promise<T | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(`${DLN_BASE}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ac.signal,
      });
      return r.ok ? (await r.json()) as T : null;
    } catch (e) { this.logger.warn(`POST ${path}: ${(e as Error)?.message}`); return null; }
    finally { clearTimeout(timer); }
  }

  private amount(off?: DlnOffer): number {
    const raw = sv(off?.amount);
    const dec = off?.decimals ?? 18;
    return raw ? Number(raw) / 10 ** dec : 0;
  }

  private orderToHop(o: DlnOrder): OrbiterHop | null {
    const srcChain = sv(o.giveOfferWithMetadata?.chainId);
    const dstChain = sv(o.takeOfferWithMetadata?.chainId);
    if (!srcChain || !dstChain) return null;
    const s = DEBRIDGE_CHAINS[srcChain];
    const t = DEBRIDGE_CHAINS[dstChain];
    const srcTx = sv(o.createdSrcEventMetadata?.transactionHash) ?? sv(o.createEventTransactionHash) ?? '';
    const dstTx = sv(o.fulfilledDstEventMetadata?.transactionHash) ?? '';
    const ts = (o.createdSrcEventMetadata?.blockTimeStamp ?? o.creationTimestamp ?? 0) * 1000;
    return {
      sourceId: srcTx, targetId: dstTx,
      sourceChain: srcChain, targetChain: dstChain,
      sourceChainName: s?.name ?? `chain ${srcChain}`,
      targetChainName: t?.name ?? `chain ${dstChain}`,
      sourceNet: s?.net ?? 'UNKNOWN', targetNet: t?.net ?? 'UNKNOWN',
      sourceTxUrl: s && srcTx ? s.tx(srcTx) : '',
      targetTxUrl: t && dstTx ? t.tx(dstTx) : '',
      amount: this.amount(o.giveOfferWithMetadata),
      symbol: o.giveOfferWithMetadata?.symbol ?? '',
      usd: 0,
      sourceTime: ts,
      sourceAddress: sv(o.makerSrc) ?? undefined,
      targetWallet: sv(o.receiverDst) ?? undefined,
    };
  }

  // Resolve a tx hash (source OR destination) to its deBridge cross-chain hop.
  async resolve(hash: string): Promise<OrbiterHop | null> {
    const ids = await this.getJson<{ orderIds?: Array<{ stringValue?: string }> }>(`/Transaction/${hash}/orderIds`);
    const orderId = ids?.orderIds?.[0]?.stringValue;
    if (!orderId) return null;
    const order = await this.getJson<DlnOrder>(`/Orders/${orderId}`);
    if (!order) return null;
    const hop = this.orderToHop(order);
    if (hop) this.logger.log(`[deBridge] resolve ${hash.slice(0, 12)}… → ${hop.sourceChainName}→${hop.targetChainName}`);
    return hop;
  }

  // Import a window of orders (filteredList paginated newest-first, then enrich
  // each with detail to get addresses + dest tx). Bounded by limit.
  async feed(opts: {
    sourceChain?: string; targetChain?: string; minUsd?: number; sinceMs?: number; limit?: number;
  }): Promise<{ hops: OrbiterHop[]; diag: string | null }> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
    const sinceMs = opts.sinceMs ?? 0;
    const body: Record<string, unknown> = { orderStates: ORDER_STATES, take: Math.min(limit, 100) };
    if (opts.sourceChain && NET_TO_DEBRIDGE[opts.sourceChain]) body.giveChainIds = [Number(NET_TO_DEBRIDGE[opts.sourceChain])];
    if (opts.targetChain && NET_TO_DEBRIDGE[opts.targetChain]) body.takeChainIds = [Number(NET_TO_DEBRIDGE[opts.targetChain])];

    // 1) paginate the list (skip) until we have enough / pass the time window.
    const list: DlnOrder[] = [];
    const MAX_PAGES = 20;
    for (let page = 0; page < MAX_PAGES && list.length < limit; page++) {
      const res = await this.postJson<{ orders?: DlnOrder[] }>('/Orders/filteredList', { ...body, skip: page * 100 });
      const orders = res?.orders ?? [];
      if (!orders.length) break;
      let passed = false;
      for (const o of orders) {
        if (sinceMs && (o.creationTimestamp ?? 0) * 1000 < sinceMs) { passed = true; break; }
        list.push(o);
        if (list.length >= limit) break;
      }
      if (passed || orders.length < 100) break;
    }
    if (!list.length) return { hops: [], diag: 'deBridge: ордеров не найдено (проверьте сети/период)' };

    // 2) enrich with detail (addresses + dest tx) in parallel batches.
    const hops: OrbiterHop[] = [];
    const minUsd = opts.minUsd ?? 0;
    const BATCH = 8;
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH);
      const detailed = await Promise.all(batch.map(async (o) => {
        const id = sv(o.orderId);
        const full = id ? await this.getJson<DlnOrder>(`/Orders/${id}`) : null;
        return this.orderToHop(full ?? o);
      }));
      for (const h of detailed) {
        if (!h) continue;
        if (minUsd && (h.usd || 0) < minUsd) continue; // deBridge has no USD → minUsd filters nothing unless 0
        hops.push(h);
      }
    }
    return { hops, diag: hops.length ? null : 'deBridge: подходящих ордеров не найдено' };
  }
}
