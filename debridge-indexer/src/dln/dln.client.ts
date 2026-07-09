import { Injectable, Logger } from '@nestjs/common';

// Client for the public DLN stats API behind app.debridge.com/orders.
//   • list:   POST /api/Orders/filteredList   (newest-first, skip/take, totalCount)
//   • detail: GET  /api/Orders/{orderId}      (sender/receiver + src/dst tx)
//   • byHash: GET  /api/Transaction/{hash}/orderIds
const DLN_BASE = 'https://stats-api.dln.trade/api';
const ORDER_STATES = ['Fulfilled', 'SentUnlock', 'ClaimedUnlock'];

export interface ChainDef { name: string; net: string; }
export const DLN_CHAINS: Record<string, ChainDef> = {
  '1':        { name: 'Ethereum',  net: 'ETH' },
  '56':       { name: 'BSC',       net: 'BSC' },
  '137':      { name: 'Polygon',   net: 'POLYGON' },
  '42161':    { name: 'Arbitrum',  net: 'ARBITRUM' },
  '8453':     { name: 'Base',      net: 'BASE' },
  '10':       { name: 'Optimism',  net: 'UNKNOWN' },
  '43114':    { name: 'Avalanche', net: 'UNKNOWN' },
  '59144':    { name: 'Linea',     net: 'UNKNOWN' },
  '100':      { name: 'Gnosis',    net: 'UNKNOWN' },
  '146':      { name: 'Sonic',     net: 'UNKNOWN' },
  '7565164':  { name: 'Solana',    net: 'SOLANA' },
};
export const NET_TO_DLN: Record<string, string> = {
  ETH: '1', BSC: '56', POLYGON: '137', ARBITRUM: '42161', BASE: '8453', SOLANA: '7565164',
};

type Scalar = { stringValue?: string | null } | string | null | undefined;
export const sv = (x: Scalar): string | null => (x == null ? null : typeof x === 'string' ? x : x.stringValue ?? null);

interface DlnOffer { chainId?: Scalar; amount?: Scalar; decimals?: number; symbol?: string; }
interface DlnEventMeta { transactionHash?: Scalar; blockTimeStamp?: number; }
export interface DlnOrder {
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
export class DlnClient {
  private readonly logger = new Logger(DlnClient.name);

  static amount(off?: DlnOffer): number | null {
    const raw = sv(off?.amount);
    if (raw == null) return null;
    return Number(raw) / 10 ** (off?.decimals ?? 18);
  }

  private async getJson<T>(path: string): Promise<T | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(`${DLN_BASE}${path}`, { signal: ac.signal });
      return r.ok ? (await r.json()) as T : null;
    } catch (e) { this.logger.warn(`GET ${path}: ${(e as Error)?.message}`); return null; }
    finally { clearTimeout(timer); }
  }

  // Page of orders newest-first. skip = offset.
  async list(skip: number, take: number, giveChain?: string, takeChain?: string): Promise<DlnOrder[]> {
    const body: Record<string, unknown> = { orderStates: ORDER_STATES, skip, take: Math.min(take, 100) };
    if (giveChain && NET_TO_DLN[giveChain]) body.giveChainIds = [Number(NET_TO_DLN[giveChain])];
    if (takeChain && NET_TO_DLN[takeChain]) body.takeChainIds = [Number(NET_TO_DLN[takeChain])];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(`${DLN_BASE}/Orders/filteredList`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ac.signal,
      });
      if (!r.ok) return [];
      const j = await r.json() as { orders?: DlnOrder[] };
      return j.orders ?? [];
    } catch (e) { this.logger.warn(`list skip=${skip}: ${(e as Error)?.message}`); return []; }
    finally { clearTimeout(timer); }
  }

  detail(orderId: string): Promise<DlnOrder | null> {
    return this.getJson<DlnOrder>(`/Orders/${orderId}`);
  }

  async orderIdsByTx(hash: string): Promise<string[]> {
    const j = await this.getJson<{ orderIds?: Array<{ stringValue?: string }> }>(`/Transaction/${hash}/orderIds`);
    return (j?.orderIds ?? []).map((o) => o.stringValue).filter((s): s is string => !!s);
  }
}
