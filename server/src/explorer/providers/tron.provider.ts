import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TransferItem } from './evm.provider';

const TRON_BASE = 'https://apilist.tronscanapi.com/api';

@Injectable()
export class TronProvider {
  private readonly logger = new Logger(TronProvider.name);
  private readonly key: () => string;
  // Short-TTL cache of the /account response so balance + token balances + label
  // share a single request (TronScan rate-limits hard without a paid key).
  private accountCache = new Map<string, { data: Record<string, unknown>; at: number }>();
  private static readonly ACCOUNT_TTL = 15000;

  constructor(cfg: ConfigService) { this.key = () => cfg.get<string>('TRONSCAN_API_KEY', ''); }

  private headers(): Record<string, string> {
    const k = this.key();
    return k ? { 'TRON-PRO-API-KEY': k } : {};
  }

  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  // GET JSON with backoff on rate-limit (HTTP 403/429/5xx or a rate-limit
  // message body — TronScan sometimes returns 200 with one).
  private async fetchJson(url: string, tries = 4): Promise<Record<string, unknown>> {
    let last: Record<string, unknown> = {};
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { headers: this.headers() });
        if (r.status === 429 || r.status === 403 || r.status >= 500) { await this.sleep(500 * (i + 1)); continue; }
        const j = await r.json() as Record<string, unknown>;
        last = j;
        const msg = String(j['message'] ?? j['Error'] ?? j['error'] ?? '');
        if (/rate|limit|frequenc|too many|forbidden/i.test(msg)) { await this.sleep(500 * (i + 1)); continue; }
        return j;
      } catch (e) {
        this.logger.warn(`[TRON] ${url.split('?')[0]} retry ${i + 1}: ${(e as Error)?.message}`);
        await this.sleep(400 * (i + 1));
      }
    }
    return last;
  }

  private async getAccount(address: string): Promise<Record<string, unknown>> {
    const c = this.accountCache.get(address);
    if (c && Date.now() - c.at < TronProvider.ACCOUNT_TTL) return c.data;
    const data = await this.fetchJson(`${TRON_BASE}/account?address=${address}`);
    this.accountCache.set(address, { data, at: Date.now() });
    return data;
  }

  async fetchTx(hash: string): Promise<TransferItem | null> {
    // Retry the empty case too: a rate-limited TronScan can return 200 with a
    // body missing the tx fields.
    for (let i = 0; i < 3; i++) {
      const j = await this.fetchJson(`${TRON_BASE}/transaction-info?hash=${hash}`);
      if (j['ownerAddress'] || j['contractData'] || (j['trc20TransferInfo'] as unknown[])?.length) {
        return this.parseTx(hash, j);
      }
      await this.sleep(500 * (i + 1));
    }
    return null;
  }

  private parseTx(hash: string, j: Record<string, unknown>): TransferItem {
    const cd = (j['contractData'] ?? {}) as Record<string, unknown>;
    const trc20s = (j['trc20TransferInfo'] || []) as Array<Record<string, unknown>>;
    const timestamp = j['timestamp'] ? Number(j['timestamp']) : undefined; // TronScan returns ms

    if (trc20s.length > 1) {
      const transfers = trc20s.map((t) => ({
        network: 'TRON', hash,
        from: t['from_address'] as string,
        to: t['to_address'] as string,
        amount: Number(t['amount_str']) / 10 ** Number(t['decimals'] || 6),
        asset: (t['symbol'] || 'TRC20') as string,
      }));
      const first = transfers[0];
      return { network: 'TRON', hash, from: j['ownerAddress'] as string || first.from, to: first.to, amount: first.amount, asset: first.asset, timestamp, transfers };
    }

    const trc20 = trc20s[0] || null;
    // For a TRC20 transfer, ownerAddress/toAddress describe the CONTRACT CALL
    // (toAddress == token contract), so the real wallet endpoints live in
    // trc20TransferInfo — prefer them. Fall back to the call addresses for
    // native TRX transfers (no trc20 info).
    return {
      network: 'TRON', hash,
      from: (trc20?.['from_address'] || j['ownerAddress'] || cd['owner_address'] || null) as string | null,
      to: (trc20?.['to_address'] || j['toAddress'] || cd['to_address'] || null) as string | null,
      amount: trc20 ? Number(trc20['amount_str']) / 10 ** Number(trc20['decimals'] || 6) : cd['amount'] ? Number(cd['amount']) / 1e6 : undefined,
      asset: (trc20?.['symbol'] || 'TRX') as string,
      timestamp,
    };
  }

  async fetchAddressLabel(address: string): Promise<{ label: string | null }> {
    const j = await this.getAccount(address);
    // TronScan exposes the exchange/entity tag in `addressTag` (e.g. "Bybit");
    // `name`/`publicTag` cover contracts and other labelled accounts.
    const raw = (j['addressTag'] || j['publicTag'] || j['name'] || '') as string;
    const label = String(raw).trim();
    return { label: label || null };
  }

  // Native TRX balance from the TronScan account endpoint (balance is in SUN).
  async fetchBalance(address: string): Promise<{ amount: number | null; asset: string; diag: string | null }> {
    try {
      const j = await this.getAccount(address);
      const bal = j['balance'];
      if (bal == null) return { amount: null, asset: 'TRX', diag: 'TronScan: баланс недоступен' };
      return { amount: Number(bal) / 1e6, asset: 'TRX', diag: null };
    } catch (e) {
      return { amount: null, asset: 'TRX', diag: String((e as Error)?.message || e) };
    }
  }

  // TRC-20 token balances from the same (cached) TronScan account endpoint.
  async fetchTokenBalances(address: string): Promise<{ asset: string; amount: number }[]> {
    try {
      const j = await this.getAccount(address);
      const list = (j['trc20token_balances'] || j['withPriceTokens'] || []) as Array<Record<string, unknown>>;
      const out: { asset: string; amount: number }[] = [];
      for (const t of list) {
        const dec = Number(t['tokenDecimal'] ?? 6);
        const amount = Number(t['balance'] ?? 0) / 10 ** dec;
        const sym = ((t['tokenAbbr'] || t['tokenName'] || 'TRC20') as string).toUpperCase();
        if (amount > 0) out.push({ asset: sym, amount });
      }
      return out.slice(0, 25);
    } catch { return []; }
  }

  async fetchWalletTransfers(address: string, opts: { native: boolean; token: boolean; limit: number }): Promise<{ transfers: TransferItem[]; diag: string | null }> {
    const out: TransferItem[] = [];
    let diag: string | null = null;
    const PAGE = 50; // tronscan caps a page at 50 → paginate via `start`

    // Page through `url(start, limit)` until enough rows / short page / cap.
    const paginate = async (
      build: (start: number, lim: number) => string,
      rowsKey: string,
      onRows: (rows: Array<Record<string, unknown>>) => void,
    ) => {
      let got = 0;
      for (let start = 0; got < opts.limit && start < opts.limit; start += PAGE) {
        const lim = Math.min(PAGE, opts.limit - got);
        const j = await this.fetchJson(build(start, lim));
        if (j['message'] && !j[rowsKey]) { diag = String(j['message']); break; }
        const rows = (j[rowsKey] || []) as Array<Record<string, unknown>>;
        if (!rows.length) break;
        onRows(rows);
        got += rows.length;
        if (rows.length < lim) break; // last page
      }
    };

    if (opts.token) {
      await paginate(
        (start, lim) => `${TRON_BASE}/token_trc20/transfers?relatedAddress=${address}&limit=${lim}&start=${start}`,
        'token_transfers',
        (rows) => rows.forEach((t) => {
          const info = (t['tokenInfo'] || {}) as Record<string, unknown>;
          const dec = Number(info['tokenDecimal'] || 6);
          out.push({ network: 'TRON', hash: t['transaction_id'] as string, from: t['from_address'] as string, to: t['to_address'] as string, amount: Number(t['quant']) / 10 ** dec, asset: ((info['tokenAbbr'] || '') as string).toUpperCase(), timestamp: Number(t['block_ts']) });
        }),
      );
    }
    if (opts.native) {
      await paginate(
        (start, lim) => `${TRON_BASE}/transfer?sort=-timestamp&limit=${lim}&start=${start}&address=${address}`,
        'data',
        (rows) => rows.forEach((t) => {
          // The reliable ticker is tokenInfo.tokenAbbr ("trx"); the top-level
          // tokenName is often "_" for native TRX, which mislabels the asset.
          const info = (t['tokenInfo'] || {}) as Record<string, unknown>;
          const dec = Number(info['tokenDecimal'] ?? 6);
          const abbr = String(info['tokenAbbr'] || t['tokenName'] || 'TRX');
          const asset = abbr.toLowerCase() === 'trx' || abbr === '_' ? 'TRX' : abbr.toUpperCase();
          out.push({
            network: 'TRON',
            hash: (t['transactionHash'] || t['hash']) as string,
            from: t['transferFromAddress'] as string,
            to: t['transferToAddress'] as string,
            amount: Number(t['amount']) / 10 ** dec,
            asset,
            timestamp: Number(t['timestamp']),
          });
        }),
      );
    }
    return { transfers: out, diag: out.length ? null : diag };
  }
}
