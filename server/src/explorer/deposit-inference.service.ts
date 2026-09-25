import { Injectable, Logger } from '@nestjs/common';
import type { TransferItem } from './providers/evm.provider';
import type { LabelSource } from './entities/address-label.entity';

// Exchange deposit addresses, inferred from behaviour instead of scraped.
//
// A deposit address forwards (almost) everything it receives to its exchange's
// hot wallet — one-off order addresses (FixedFloat) and permanent per-user ones
// (Binance) alike. Checked on TRON against OKX's own tags: 6/6 deposits of
// Binance, Bybit, Kraken and FixedFloat matched, and the rule fired for 1 of
// 105 addresses the hot wallets paid out to. So: if ≥95% of an address's
// outgoing token value went to wallets of ONE known entity, it is that
// entity's deposit.
//
// The entity is known from an anchor — a labelled exchange wallet in the
// registry or an explorer tag. Deposits are never anchors: otherwise a
// person's own wallet that always tops up its Binance deposit would be tagged
// "Binance" too. The one extension: an unlabelled destination that collects
// from many senders and itself forwards ≥95% to an anchor is that entity's
// collector (Kraken sweeps deposits through such wallets) — found one hop
// deep, never chained further.

export const INFERRED: LabelSource = 'inferred';
const SHARE = 0.95;           // of outgoing value, to call it a deposit
const CANDIDATE = 0.2;        // destinations below this share aren't looked up
const MAX_CANDIDATES = 3;
const COLLECTOR_SENDERS = 10; // distinct senders for an unlabelled wallet to count as a collector

// "Exchange: Binance. User" → "Binance"; "Bybit: Hot Wallet" → "Bybit";
// "Binance-Hot 3" → "Binance"; "FixedFloat. DepositAndWithdraw_2" and
// TronScan's "FixedFloat Exchange Hot Wallet" → "FixedFloat".
export function entityOf(label: string | null | undefined): string | null {
  if (!label) return null;
  let s = label.trim().replace(/^(exchange|cex|dex|bridge|defi|service|entity|mixer)\s*:\s*/i, '');
  s = s.split(/\.\s+|:\s*|\s+[-–—]\s+|\s*\(/)[0];
  s = s.replace(/[\s_-]*(hot|cold)\b.*$/i, '').replace(/[\s_-]+\d+$/, '').replace(/\s+(exchange|wallet)$/i, '').trim();
  return s.length >= 2 ? s : null;
}

// A label that names a customer's deposit rather than the exchange's own
// wallet — never used as an anchor.
export function isDepositLabel(label: string, source?: LabelSource | null): boolean {
  if (source === INFERRED) return !/\bcollector\b/i.test(label);
  return /\bUser\b|\bdeposit address\b|депозит/i.test(label);
}

export interface KnownLabel { label: string; source: LabelSource }
export interface InferenceDeps {
  // Registry entry or explorer tag of an address — never inferred on the fly.
  labelOf: (address: string) => Promise<KnownLabel | null>;
  // Recent transfers of another address (for the collector check).
  transfersOf: (address: string) => Promise<TransferItem[]>;
  // Store a discovered collector so the next lookup doesn't redo the work.
  remember: (address: string, label: string) => void;
}
export interface Inference { label: string; entity: string; share: number; via: string[] }

const same = (a?: string | null, b?: string | null) =>
  !!a && !!b && (/^0x/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b);

// Outgoing token value per destination, as shares of the total. Weighted by
// USD where the provider priced it; by transfer count otherwise.
export function outgoingShares(address: string, transfers: TransferItem[], native: Set<string>): Array<[string, number]> {
  const out = transfers.filter((t) => same(t.from, address) && t.to && !same(t.to, address)
    && !native.has(t.asset ?? '') && (t.amount ?? 0) > 0);
  if (!out.length) return [];
  const byUsd = out.every((t) => t.usdValue != null);
  const w = new Map<string, number>();
  for (const t of out) {
    const k = /^0x/i.test(t.to!) ? t.to!.toLowerCase() : t.to!;
    w.set(k, (w.get(k) ?? 0) + (byUsd ? (t.usdValue as number) : 1));
  }
  const total = [...w.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return [...w.entries()].map(([k, v]) => [k, v / total] as [string, number]).sort((a, b) => b[1] - a[1]);
}

@Injectable()
export class DepositInferenceService {
  private readonly logger = new Logger(DepositInferenceService.name);

  async infer(address: string, transfers: TransferItem[], native: Set<string>, deps: InferenceDeps): Promise<Inference | null> {
    const shares = outgoingShares(address, transfers, native);
    const candidates = shares.filter(([, s]) => s >= CANDIDATE).slice(0, MAX_CANDIDATES);
    if (!candidates.length) return null;

    const perEntity = new Map<string, { name: string; share: number; via: string[] }>();
    let collectorChecks = 1;
    for (const [dest, share] of candidates) {
      let entity = await this.anchorEntity(dest, deps);
      if (!entity && collectorChecks-- > 0) entity = await this.collectorEntity(dest, native, deps);
      if (!entity) continue;
      const k = entity.toLowerCase();
      const cur = perEntity.get(k) ?? { name: entity, share: 0, via: [] };
      cur.share += share; cur.via.push(dest);
      perEntity.set(k, cur);
    }
    const best = [...perEntity.values()].sort((a, b) => b.share - a.share)[0];
    if (!best || best.share < SHARE) return null;
    return { label: `${best.name}: deposit (inferred)`, entity: best.name, share: best.share, via: best.via };
  }

  private async anchorEntity(address: string, deps: InferenceDeps): Promise<string | null> {
    const known = await deps.labelOf(address).catch(() => null);
    if (!known || isDepositLabel(known.label, known.source)) return null;
    return entityOf(known.label);
  }

  // An unlabelled wallet that many addresses pay into and that forwards
  // everything to one anchored entity is that entity's collector.
  private async collectorEntity(address: string, native: Set<string>, deps: InferenceDeps): Promise<string | null> {
    let txs: TransferItem[];
    try { txs = await deps.transfersOf(address); } catch { return null; }
    const senders = new Set(txs.filter((t) => same(t.to, address) && t.from).map((t) => t.from as string));
    if (senders.size < COLLECTOR_SENDERS) return null;
    const perEntity = new Map<string, { name: string; share: number }>();
    for (const [dest, share] of outgoingShares(address, txs, native).filter(([, s]) => s >= CANDIDATE).slice(0, MAX_CANDIDATES)) {
      const entity = await this.anchorEntity(dest, deps);
      if (!entity) continue;
      const cur = perEntity.get(entity.toLowerCase()) ?? { name: entity, share: 0 };
      cur.share += share;
      perEntity.set(entity.toLowerCase(), cur);
    }
    const best = [...perEntity.values()].sort((a, b) => b.share - a.share)[0];
    if (!best || best.share < SHARE) return null;
    this.logger.log(`collector of ${best.name}: ${address}`);
    deps.remember(address, `${best.name}: collector (inferred)`);
    return best.name;
  }
}
