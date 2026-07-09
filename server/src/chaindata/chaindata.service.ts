import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExplorerService } from '../explorer/explorer.service';
import type { TransferItem } from '../explorer/providers/evm.provider';
import type { SourceStatus } from '../explorer/provider-health.service';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';

export interface WalletTxOpts {
  native: boolean;
  token: boolean;
  limit: number;
  force?: boolean;
  fromMs?: number; // inclusive lower bound on block time (ms)
  toMs?: number;   // inclusive upper bound on block time (ms)
  asset?: string;  // filter to a single asset/ticker
}

const isEvm = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const normAddr = (a: string) => (isEvm(a) ? a.toLowerCase() : a);

@Injectable()
export class ChainDataService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(Transaction) private readonly txs: Repository<Transaction>,
    private readonly explorer: ExplorerService,
  ) {}

  // Serve a wallet's transfers from the shared store, fetching from the explorer
  // only the first time (or when `force`). The store is deduplicated and shared
  // across all projects/users, so the same wallet is never fetched twice.
  async walletTransfers(
    network: string,
    address: string,
    opts: WalletTxOpts,
  ): Promise<{ transfers: TransferItem[]; diag: string | null; status?: SourceStatus }> {
    network = network.toUpperCase();
    const addr = normAddr(address);

    const wallet = await this.wallets.findOneBy({ network, address: addr });
    const hasRange = opts.fromMs != null || opts.toMs != null;

    // What we already hold for this wallet (count + earliest block time) — used to
    // decide whether a (re)fetch is warranted rather than blindly trusting the
    // `txsLoadedAt` flag (which a failed/rate-limited first fetch could have set
    // while storing nothing).
    const agg = await this.txs
      .createQueryBuilder('t')
      .select('COUNT(1)', 'cnt')
      .addSelect('COUNT(t.block_ts)', 'withTs')
      .addSelect('MIN(t.block_ts)', 'oldest')
      .where('t.network = :network', { network })
      .andWhere('(t.fromAddr = :addr OR t.toAddr = :addr)', { addr })
      .getRawOne<{ cnt: string; withTs: string; oldest: string | null }>();
    const stored = Number(agg?.cnt ?? 0);
    const withTs = Number(agg?.withTs ?? 0);
    const oldestMs = agg?.oldest != null ? Number(agg.oldest) : null;

    const loadedAt = wallet?.txsLoadedAt ? new Date(wallet.txsLoadedAt).getTime() : 0;
    const stale = Date.now() - loadedAt > 10 * 60 * 1000; // 10-min retry throttle
    // A requested period that reaches older than our earliest stored tx means the
    // store may be missing that window → refresh.
    const rangeUncovered = hasRange && (oldestMs == null || (opts.fromMs != null && opts.fromMs < oldestMs));
    // Some stored rows have no block time (older/failed parse) — a date filter
    // silently drops them, so refresh (throttled) to backfill their timestamps.
    const missingTs = hasRange && stored > withTs && stale;
    // (Re)fetch when: forced, never loaded, nothing stored yet and the last
    // attempt is stale (self-heals a wallet whose earlier fetch failed), the
    // requested period isn't covered, or stored rows are missing timestamps.
    const needFetch = opts.force || !wallet?.txsLoadedAt || (stored === 0 && stale) || rangeUncovered || missingTs;

    let fetchDiag: string | null = null;
    let fetchStatus: SourceStatus | undefined;
    if (needFetch) {
      const res = await this.explorer.fetchWalletTransfers(network, addr, {
        native: opts.native, token: opts.token, limit: opts.limit,
      });
      fetchDiag = res.diag;
      fetchStatus = res.status;
      await this.persist(network, res.transfers);
      // Record the attempt time regardless of outcome, so a genuinely-empty or
      // persistently-failing wallet is retried at most once per staleness window.
      await this.markLoaded(network, addr);
    }

    // Query the (full) stored history for this wallet, sliced by the requested
    // date range / asset — so filtering spans everything ever loaded, not just
    // the most recent page.
    const qb = this.txs
      .createQueryBuilder('t')
      .where('t.network = :network', { network })
      .andWhere('(t.fromAddr = :addr OR t.toAddr = :addr)', { addr });
    if (opts.fromMs != null) qb.andWhere('t.blockTs >= :fromMs', { fromMs: opts.fromMs });
    if (opts.toMs != null) qb.andWhere('t.blockTs <= :toMs', { toMs: opts.toMs });
    if (opts.asset) qb.andWhere('t.asset = :asset', { asset: opts.asset });
    const rows = await qb.orderBy('t.blockTs', 'DESC', 'NULLS LAST').take(opts.limit).getMany();

    // Surface the source status so the UI can distinguish a genuine empty wallet
    // from a down/drifted source. When we served purely from cache, having rows
    // means the source was 'ok' at load time.
    const status: SourceStatus | undefined = fetchStatus ?? (rows.length ? 'ok' : undefined);
    return { transfers: rows.map(toTransferItem), diag: rows.length ? null : fetchDiag, status };
  }

  private async persist(network: string, transfers: TransferItem[]): Promise<void> {
    if (!transfers.length) return;
    // Dedup within this batch (same dedupKey twice in one fetch) before upserting.
    const byKey = new Map<string, Transaction>();
    for (const t of transfers) {
      if (!t.hash || (!t.from && !t.to)) continue;
      const fromAddr = t.from ? normAddr(t.from) : null;
      const toAddr = t.to ? normAddr(t.to) : null;
      const amount = t.amount ?? null;
      const dedupKey = [network, t.hash, fromAddr ?? '', toAddr ?? '', t.asset ?? '', amount ?? ''].join('|');
      byKey.set(dedupKey, this.txs.create({
        dedupKey, network, hash: t.hash,
        blockTs: t.timestamp ?? null,
        fromAddr, toAddr,
        asset: t.asset ?? null,
        amount,
        usd: t.usdValue ?? null,
        fromLabel: t.fromLabel ?? null,
        toLabel: t.toLabel ?? null,
      }));
    }
    const rows = [...byKey.values()];
    if (rows.length) await this.txs.upsert(rows, { conflictPaths: ['dedupKey'], skipUpdateIfNoValuesChanged: true });
  }

  private async markLoaded(network: string, address: string): Promise<void> {
    await this.wallets.upsert(
      { network, address, txsLoadedAt: new Date() },
      { conflictPaths: ['network', 'address'], skipUpdateIfNoValuesChanged: false },
    );
  }
}

function toTransferItem(t: Transaction): TransferItem {
  return {
    network: t.network,
    hash: t.hash,
    from: t.fromAddr,
    to: t.toAddr,
    amount: t.amount ?? undefined,
    asset: t.asset ?? undefined,
    usdValue: t.usd ?? undefined,
    timestamp: t.blockTs ?? undefined,
    fromLabel: t.fromLabel ?? undefined,
    toLabel: t.toLabel ?? undefined,
  };
}
