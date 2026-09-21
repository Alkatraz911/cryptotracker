import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SourceStatus } from '../provider-health.service';

const EVM_CHAINS: Record<string, number> = {
  ETH: 1, BSC: 56, POLYGON: 137, ARBITRUM: 42161, BASE: 8453,
};
const EVM_BASE = 'https://api.etherscan.io/v2/api';
// Chains blocked on Etherscan free tier — scrape BscScan / BaseScan HTML (no key needed)
const SCAN_HOSTS: Record<string, string> = {
  BSC: 'https://bscscan.com',
  BASE: 'https://basescan.org',
};
// BscScan now answers every server-side fetch with a Cloudflare challenge (403),
// so BSC history comes from NodeReal's enhanced RPC (nr_getAssetTransfers)
// instead of the scraper. Their public endpoint works without registration; set
// NODEREAL_API_KEY to use a private (higher rate-limit) one.
const NODEREAL_HOSTS: Record<string, string> = { BSC: 'bsc-mainnet' };
const NODEREAL_PUBLIC_KEY = '64a9df0874fb4a93b9d0a3849de012d3';
const PUBLIC_RPC: Record<string, string> = {
  ETH:      'https://eth.llamarpc.com',
  BSC:      'https://bsc-dataseed.binance.org',
  POLYGON:  'https://polygon-rpc.com',
  ARBITRUM: 'https://arb1.arbitrum.io/rpc',
  BASE:     'https://mainnet.base.org',
};
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const GENERIC_PROXY_NAMES = new Set([
  'TransparentUpgradeableProxy', 'ERC1967Proxy', 'BeaconProxy', 'Proxy',
  'AdminUpgradeabilityProxy', 'UpgradeableProxy', 'InitializableAdminUpgradeabilityProxy',
  'UUPSUpgradeable', 'TransparentProxy',
]);
const EIP1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

export interface TransferItem {
  network: string;
  hash: string;
  from: string | null;
  to: string | null;
  amount?: number;
  asset?: string;
  usdValue?: number;
  timestamp?: number;
  fromLabel?: string | null; // entity tag for the from address (exchange/contract)
  toLabel?: string | null;   // entity tag for the to address
  transfers?: TransferItem[];
  source?: string | null;    // provenance: data source this fact came from (set when read from the store)
  fetchedAt?: number | null; // provenance: when it was pulled into the store (ms)
}

// A wallet-transfer fetch result carries the source's health so callers can tell
// a genuine zero apart from a down/drifted source (see ProviderHealthService).
export interface WalletTransfersResult {
  transfers: TransferItem[];
  diag: string | null;
  status?: SourceStatus;
  source?: string;
}

@Injectable()
export class EvmProvider {
  private readonly logger = new Logger(EvmProvider.name);
  private readonly key: () => string;
  private readonly nodeRealKey: () => string;

  constructor(cfg: ConfigService) {
    this.key = () => cfg.get<string>('ETHERSCAN_API_KEY', '');
    this.nodeRealKey = () => cfg.get<string>('NODEREAL_API_KEY', '') || NODEREAL_PUBLIC_KEY;
  }

  private nativeAsset(network: string): string {
    return ({ ETH: 'ETH', BSC: 'BNB', POLYGON: 'POL', ARBITRUM: 'ETH', BASE: 'ETH' } as Record<string, string>)[network] || '';
  }

  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  private async rpcPost(rpc: string, method: string, params: unknown[]): Promise<unknown> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ac.signal,
      });
      const j = await r.json() as { error?: { message?: string }; result?: unknown };
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      return j.result ?? null;
    } finally {
      clearTimeout(timer);
    }
  }

  private decodeAbiString(hex: string | null): string | null {
    if (!hex || hex === '0x') return null;
    const h = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (h.length < 128) {
      const s = Buffer.from(h.padEnd(64, '0'), 'hex').toString('utf8').replace(/\0/g, '').trim();
      return s.length && s.length <= 32 ? s : null;
    }
    const len = parseInt(h.slice(64, 128), 16);
    if (!len || len > 200) return null;
    try {
      return Buffer.from(h.slice(128, 128 + len * 2), 'hex').toString('utf8').replace(/\0/g, '').trim() || null;
    } catch { return null; }
  }

  private async fetchJsonRetry(url: string, tries = 4): Promise<Record<string, unknown>> {
    let last: Record<string, unknown> = {};
    for (let i = 0; i < tries; i++) {
      const r = await fetch(url);
      const j = await r.json() as Record<string, unknown>;
      last = j;
      const note = `${j['message'] ?? ''} ${typeof j['result'] === 'string' ? j['result'] : ''}`;
      if (/rate limit/i.test(note)) { await this.sleep(300 * (i + 1)); continue; }
      return j;
    }
    return last;
  }

  private async evmTxRpc(network: string, hash: string): Promise<TransferItem | null> {
    const rpc = PUBLIC_RPC[network];
    if (!rpc) return null;
    let tx: Record<string, unknown> | null;
    try {
      tx = await this.rpcPost(rpc, 'eth_getTransactionByHash', [hash]) as Record<string, unknown> | null;
    } catch (e) {
      this.logger.error(`[evmTxRpc] ${network} RPC error: ${(e as Error).message}`);
      return null;
    }
    if (!tx || !tx['from']) { this.logger.warn(`[evmTxRpc] ${network} tx not found: ${hash}`); return null; }

    const nativeValue = BigInt((tx['value'] as string) ?? '0x0');
    // Block timestamp (ms) so the frontend can date the edge.
    let timestamp: number | undefined;
    const blockNum = tx['blockNumber'] as string | undefined;
    if (blockNum) {
      const block = await this.rpcPost(rpc, 'eth_getBlockByNumber', [blockNum, false]).catch(() => null) as Record<string, unknown> | null;
      const tsHex = block?.['timestamp'] as string | undefined;
      if (tsHex) timestamp = Number(BigInt(tsHex)) * 1000;
    }
    const receipt = await this.rpcPost(rpc, 'eth_getTransactionReceipt', [hash]).catch(() => null) as Record<string, unknown> | null;
    const logs = ((receipt?.['logs'] ?? []) as Array<Record<string, unknown>>);
    const transferLogs = logs.filter(
      (l) => (l['topics'] as string[])?.[0]?.toLowerCase() === TRANSFER_TOPIC && (l['topics'] as string[]).length >= 3,
    );

    const all: Array<{ from: string; to: string | null; amount: number; asset: string }> = [];
    if (nativeValue > 0n) {
      all.push({ from: tx['from'] as string, to: tx['to'] as string | null, amount: Number(nativeValue) / 1e18, asset: this.nativeAsset(network) });
    }

    if (transferLogs.length > 0) {
      const contracts = [...new Set(transferLogs.map((l) => (l['address'] as string).toLowerCase()))];
      const tokenInfo: Record<string, { symbol: string; decimals: number }> = {};
      await Promise.all(contracts.map(async (addr) => {
        const [symHex, decHex] = await Promise.all([
          this.rpcPost(rpc, 'eth_call', [{ to: addr, data: '0x95d89b41' }, 'latest']).catch(() => null) as Promise<string | null>,
          this.rpcPost(rpc, 'eth_call', [{ to: addr, data: '0x313ce567' }, 'latest']).catch(() => null) as Promise<string | null>,
        ]);
        const decVal = decHex ? parseInt((decHex as string).replace('0x', ''), 16) : NaN;
        tokenInfo[addr] = { symbol: this.decodeAbiString(symHex) || 'TOKEN', decimals: isNaN(decVal) ? 18 : decVal };
      }));
      for (const l of transferLogs) {
        const info = tokenInfo[(l['address'] as string).toLowerCase()];
        const raw = BigInt((l['data'] as string)?.length > 2 ? (l['data'] as string) : '0x0');
        const topics = l['topics'] as string[];
        all.push({ from: '0x' + topics[1].slice(-40), to: '0x' + topics[2].slice(-40), amount: Number(raw) / 10 ** info.decimals, asset: info.symbol });
      }
    }

    if (!all.length) return { network, hash, from: tx['from'] as string, to: tx['to'] as string | null, amount: 0, asset: this.nativeAsset(network), timestamp };
    const first = all[0];
    return { network, hash, from: first.from, to: first.to, amount: first.amount, asset: first.asset, timestamp, ...(all.length > 1 && { transfers: all as unknown as TransferItem[] }) };
  }

  async fetchTx(network: string, hash: string): Promise<TransferItem | null> {
    const chainid = EVM_CHAINS[network];
    if (!chainid) return null;
    const result = await this.evmTxRpc(network, hash);
    if (result) return result;
    const KEY = this.key();
    if (!KEY) return null;
    try {
      const url = `${EVM_BASE}?chainid=${chainid}&module=proxy&action=eth_getTransactionByHash&txhash=${hash}&apikey=${KEY}`;
      const j = await this.fetchJsonRetry(url);
      const t = j['result'] as Record<string, unknown> | null;
      if (!t || !t['from']) return null;
      const wei = BigInt((t['value'] as string) ?? '0x0');
      return { network, hash, from: t['from'] as string, to: t['to'] as string | null, amount: Number(wei) / 1e18, asset: this.nativeAsset(network) };
    } catch { return null; }
  }

  async fetchAddressLabel(network: string, address: string): Promise<{ label: string | null }> {
    const chainid = EVM_CHAINS[network];
    if (!chainid) return { label: null };
    const KEY = this.key();
    const rpc = PUBLIC_RPC[network];
    // Entity tags (exchanges etc.) come from OKLink upstream of this call; here
    // it's Etherscan's label + verified contract name, then the on-chain name().
    const apiLabel = await (async () => {
        if (!KEY) return null;
        const tj = await this.fetchJsonRetry(`${EVM_BASE}?chainid=${chainid}&module=account&action=addresslabel&address=${address}&apikey=${KEY}`);
        const tjResult = tj['result'] as Record<string, string> | null;
        if (tj['status'] === '1' && tjResult?.['label']) return tjResult['label'];
        const sj = await this.fetchJsonRetry(`${EVM_BASE}?chainid=${chainid}&module=contract&action=getsourcecode&address=${address}&apikey=${KEY}`);
        const cname = (sj['result'] as Array<Record<string, string>>)?.[0]?.['ContractName'];
        if (cname && cname.length > 0 && cname !== '0x') {
          if (!GENERIC_PROXY_NAMES.has(cname)) return cname;
          if (rpc) {
            const slotVal = await this.rpcPost(rpc, 'eth_getStorageAt', [address, EIP1967_IMPL_SLOT, 'latest']).catch(() => null) as string | null;
            if (slotVal && !/^0x0*$/.test(slotVal)) {
              const implAddr = '0x' + slotVal.slice(-40);
              const implSrc = await this.fetchJsonRetry(`${EVM_BASE}?chainid=${chainid}&module=contract&action=getsourcecode&address=${implAddr}&apikey=${KEY}`).catch(() => null);
              const implName = (implSrc?.['result'] as Array<Record<string, string>>)?.[0]?.['ContractName'];
              if (implName && implName.length > 0 && !GENERIC_PROXY_NAMES.has(implName)) return implName;
            }
          }
        }
        return null;
      })().catch(() => null);
    if (apiLabel) return { label: apiLabel };
    if (rpc) {
      const nameHex = await this.rpcPost(rpc, 'eth_call', [{ to: address, data: '0x06fdde03' }, 'latest']).catch(() => null) as string | null;
      const name = nameHex ? this.decodeAbiString(nameHex) : null;
      if (name) return { label: name };
    }
    return { label: null };
  }

  private async fetchScanPage(url: string, scanBase: string): Promise<string | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0',
          'Accept': 'text/html,*/*;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': scanBase + '/',
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: ac.signal,
      });
      if (!r.ok) { this.logger.warn(`[Scan] HTTP ${r.status} for ${url}`); return null; }
      return r.text();
    } catch (e) { this.logger.error(`[Scan] ${(e as Error).message}`); return null; }
    finally { clearTimeout(timer); }
  }

  // Parse a leading decimal number, ignoring trailing symbols (e.g. "0 BNB" → 0).
  private parseScanAmount(s: string): number {
    const m = s.replace(/,/g, '').match(/-?\d*\.?\d+/);
    return m ? parseFloat(m[0]) : 0;
  }

  // Parse a USD figure: "$0.00", "$1,234.56", "$1.5M".
  private parseScanUsd(s: string): number {
    const m = s.replace(/,/g, '').match(/\$\s*(-?\d*\.?\d+)\s*([KMB])?/i);
    if (!m) return 0;
    let v = parseFloat(m[1]);
    const suf = (m[2] || '').toUpperCase();
    if (suf === 'K') v *= 1e3; else if (suf === 'M') v *= 1e6; else if (suf === 'B') v *= 1e9;
    return v;
  }

  private parseScanRows(html: string, network: string, type: 'token' | 'native'): TransferItem[] {
    const out: TransferItem[] = [];
    const body = html.includes('<tbody') ? html.split('<tbody')[1] : html;
    for (const [, rowHtml] of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (/<th[\s>]/i.test(rowHtml)) continue;

      const hashM = rowHtml.match(/href="\/tx\/(0x[0-9a-fA-F]{64})"/i);
      if (!hashM) continue;
      const hash = hashM[1];

      // From / To via the copy-button anchors. Trailing "_" disambiguates
      // #linkIcon_t_ (To) from #linkIcon_tx_ (the tx-hash copy button).
      const fromM = rowHtml.match(/data-clipboard-text='(0x[0-9a-fA-F]{40})'(?:(?!data-clipboard-text)[\s\S])*?#linkIcon_f_/i);
      const toM   = rowHtml.match(/data-clipboard-text='(0x[0-9a-fA-F]{40})'(?:(?!data-clipboard-text)[\s\S])*?#linkIcon_t_/i);
      const from = fromM?.[1] ?? null;
      const to   = toM?.[1] ?? null;

      // Timestamp: prefer a Unix-seconds cell (legacy), else parse the full
      // datetime string BscScan/BaseScan now render in the age tooltip
      // (e.g. data-bs-title="2024-09-12 14:30:05"). Amount tooltips never look
      // like a datetime, so the generic pattern won't collide with them.
      let timestamp: number | undefined;
      const unixM = rowHtml.match(/showLocalDate[^>]*>\s*(\d{10})\s*</)
        ?? rowHtml.match(/[?&]time=(\d{10})\b/);
      if (unixM) {
        timestamp = Number(unixM[1]) * 1000;
      } else {
        // The hour may be 1 OR 2 digits (BscScan renders "2026-01-10 5:39:43").
        // Pad a single-digit hour so Date.parse gets a valid ISO string.
        const dtM = rowHtml.match(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2}):(\d{2})/);
        if (dtM) {
          const ms = Date.parse(`${dtM[1]}T${dtM[2].padStart(2, '0')}:${dtM[3]}:${dtM[4]}Z`);
          if (!isNaN(ms)) timestamp = ms;
        }
        // Last resort: a bare unix-seconds value (1.5e9–1.9e9 ≈ 2017-2030) that
        // BscScan keeps in the age cell for its "X days ago" tooltip.
        if (timestamp == null) {
          const uxM = rowHtml.match(/\b(1[5-9]\d{8})\b/);
          if (uxM) timestamp = Number(uxM[1]) * 1000;
        }
      }

      // Amount + USD from td_showAmount tooltip: "AMOUNT [SYM] | $USD".
      const titleM = rowHtml.match(/td_showAmount[^>]*data-bs-title="([^"]*)"/i);
      let amount = 0;
      let usdValue: number | undefined;
      if (titleM) {
        const [left, right] = titleM[1].split('|');
        amount = this.parseScanAmount(left ?? '');
        if (right) usdValue = this.parseScanUsd(right);
      }

      if (type === 'token') {
        // Token symbol from the token cell (last /token/ link). The visible spans
        // are truncated with "…"; the full "Name (SYMBOL)" is in the tooltip title.
        const ti = rowHtml.lastIndexOf('/token/');
        const cell = ti >= 0 ? rowHtml.slice(ti) : rowHtml;
        const symM = cell.match(/title="[^"]*\(([^)]{1,32})\)"/i)
          ?? cell.match(/text-muted">\(([^)]{1,24})\)/)
          ?? cell.match(/hash-tag text-truncate">([^<]{1,40})</);
        const asset = (symM?.[1] ?? 'TOKEN')
          .replace(/…$/, '').replace(/\.\.\.$/, '')
          .replace(/^(?:BEP-20|ERC-20|TRC-20|[A-Z]+-\d+):\s*/i, '').trim() || 'TOKEN';
        out.push({ network, hash, from, to, amount, asset, usdValue, timestamp });
      } else {
        out.push({ network, hash, from, to, amount, asset: this.nativeAsset(network), usdValue, timestamp });
      }
    }
    return out;
  }

  // Classify a scan page so a silent zero can be told apart from a real problem:
  //   ok    — rows parsed.
  //   drift — the page HAS tx rows in its markup but our parser got none (the
  //           explorer changed its layout → the scraper needs a code fix).
  //   empty — a rendered results table / explorer "no records" state (real zero).
  //   down  — no recognisable page (captcha / Cloudflare challenge / truncated).
  private classifyScanPage(html: string, parsed: number): SourceStatus {
    if (parsed > 0) return 'ok';
    if (/href="\/tx\/0x[0-9a-fA-F]{64}"/i.test(html)) return 'drift';
    if (/no matching entries|no transactions found|there are no|no records found/i.test(html)) return 'empty';
    if (/<tbody/i.test(html) && html.length > 2000) return 'empty';
    return 'down';
  }

  // Merge the statuses of the token + native sub-fetches (worst wins).
  private mergeStatus(ss: SourceStatus[]): SourceStatus {
    if (ss.includes('down')) return 'down';
    if (ss.includes('drift')) return 'drift';
    if (ss.includes('ok')) return 'ok';
    return 'empty';
  }

  // BscScan/BaseScan cap the free paginated view at 10 pages × 100 = 1000 records.
  private static readonly SCAN_MAX_PAGES = 20; // up to 2000 rows for full history
  private static readonly SCAN_PAGE_SIZE = 100;

  // Page through a scan endpoint, parsing + filtering, until `limit` kept rows
  // are collected, a page comes back empty, or the 10-page cap is hit.
  private async fetchScanPaged(
    scanBase: string, path: string, network: string, type: 'token' | 'native',
    keep: (t: TransferItem) => boolean, limit: number,
  ): Promise<{ kept: TransferItem[]; parsed: number; pages: number; failed: boolean; status: SourceStatus }> {
    const kept: TransferItem[] = [];
    let parsed = 0;
    let page = 0;
    let failed = false;
    let status: SourceStatus = 'empty';
    const ps = EvmProvider.SCAN_PAGE_SIZE;

    for (page = 1; page <= EvmProvider.SCAN_MAX_PAGES; page++) {
      const fullUrl = `${scanBase}/${path}&ps=${ps}&p=${page}`;
      const html = await this.fetchScanPage(fullUrl, scanBase);
      if (html === null) { if (page === 1) { failed = true; status = 'down'; } break; }

      const rows = this.parseScanRows(html, network, type);
      parsed += rows.length;
      // The first page decides the source's health: if it has rows the scraper
      // works; if not, classify why (drift vs empty vs blocked).
      if (page === 1) {
        status = this.classifyScanPage(html, rows.length);
        if (status === 'drift') {
          const firstTxRow = html.match(/<tr[^>]*>[\s\S]*?href="\/tx\/0x[0-9a-fA-F]{64}"[\s\S]*?<\/tr>/i);
          this.logger.error(`[Scan] ${network} ${type} PARSE DRIFT — markup has tx rows but parsed 0. First row:\n${firstTxRow?.[0]?.replace(/<[^>]+>/g, '⟨tag⟩').slice(0, 600) ?? html.slice(0, 400)}`);
        }
      }
      kept.push(...rows.filter(keep));

      if (rows.length < ps) { break; }       // last page reached
      if (kept.length >= limit) { break; }   // enough collected
    }

    return { kept: kept.slice(0, limit), parsed, pages: page, failed, status };
  }

  // ── NodeReal enhanced RPC (BSC) ───────────────────────────────────────────
  private nodeRealUrl(network: string): string | null {
    const host = NODEREAL_HOSTS[network];
    return host ? `https://${host}.nodereal.io/v1/${this.nodeRealKey()}` : null;
  }

  private static readonly NR_PAGE = 1000;   // max rows per nr_getAssetTransfers call
  private static readonly NR_MAX_PAGES = 3; // per direction — well past our own ceiling

  // One nr_getAssetTransfers call, retrying rate-limits / 5xx with backoff. A 429
  // waits noticeably longer than a transport hiccup: the shared public endpoint
  // throttles per minute, so retrying in 400ms just spends another attempt.
  private async nodeRealCall(
    url: string, params: Record<string, unknown>, tries = 4,
  ): Promise<{ transfers: Array<Record<string, unknown>>; pageKey?: string }> {
    let lastErr = '';
    for (let i = 0; i < tries; i++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 20000);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nr_getAssetTransfers', params: [params] }),
          signal: ac.signal,
        });
        if (r.status === 429 || r.status >= 500) {
          lastErr = `HTTP ${r.status}`;
          if (i < tries - 1) await this.sleep(r.status === 429 ? 1500 * (i + 1) : 400 * (i + 1));
          continue;
        }
        const j = await r.json() as {
          error?: { message?: string };
          result?: { transfers?: Array<Record<string, unknown>>; pageKey?: string };
        };
        if (j.error) {
          lastErr = j.error.message || 'RPC error';
          if (!/rate|limit|busy|exceed/i.test(lastErr)) throw new Error(lastErr);
          await this.sleep(400 * (i + 1));
          continue;
        }
        return { transfers: j.result?.transfers ?? [], pageKey: j.result?.pageKey };
      } catch (e) {
        lastErr = (e as Error)?.message || String(e);
        if (i < tries - 1) await this.sleep(400 * (i + 1));
      } finally { clearTimeout(timer); }
    }
    throw new Error(lastErr || 'NodeReal: нет ответа');
  }

  // Turn a NodeReal failure into something the analyst can act on: the shared
  // public endpoint is the usual reason for a throttle, and a free key lifts it.
  private nodeRealDiag(err: string): string {
    if (!/429/.test(err)) return `NodeReal недоступен — ${err}`;
    return this.nodeRealKey() === NODEREAL_PUBLIC_KEY
      ? 'лимит публичного эндпоинта NodeReal исчерпан — укажите бесплатный ключ в NODEREAL_API_KEY (nodereal.io)'
      : 'лимит ключа NodeReal исчерпан — попробуйте позже';
  }

  // Map one nr_getAssetTransfers row to a TransferItem. Native rows that moved no
  // value (plain contract calls) are dropped — the scraper filtered those too.
  private mapNodeRealTransfer(network: string, r: Record<string, unknown>): TransferItem | null {
    const hash = r['hash'] as string | undefined;
    const from = (r['from'] as string) || null;
    const to = (r['to'] as string) || null;
    if (!hash || (!from && !to)) return null;
    const isToken = String(r['category']) === '20';
    const dec = isToken ? Number(r['decimal'] ?? 18) : 18;
    const decimals = isNaN(dec) ? 18 : dec;
    let amount: number;
    try { amount = Number(BigInt((r['value'] as string) || '0x0')) / 10 ** decimals; } catch { return null; }
    if (!isToken && amount <= 0) return null;
    const ts = Number(r['blockTimeStamp'] ?? 0);
    return {
      network, hash, from, to, amount,
      asset: isToken ? String(r['asset'] || 'TOKEN') : this.nativeAsset(network),
      timestamp: ts ? ts * 1000 : undefined,
    };
  }

  // Wallet history from NodeReal. The API filters on ONE endpoint per call, so
  // outgoing (fromAddress) and incoming (toAddress) are fetched separately and
  // merged. Categories map to our flags: 'external' = native, '20' = tokens.
  private async fetchWalletTransfersNodeReal(
    network: string, address: string, opts: { native: boolean; token: boolean; limit: number },
  ): Promise<WalletTransfersResult> {
    const url = this.nodeRealUrl(network)!;
    const source = `nodereal:${network.toLowerCase()}`;
    const category: string[] = [];
    if (opts.native) category.push('external');
    if (opts.token) category.push('20');
    if (!category.length) return { transfers: [], diag: null, status: 'empty', source };

    const seen = new Set<string>();
    const out: TransferItem[] = [];
    let failed: string | null = null;
    let rowsSeen = 0;
    // Budget per query, not per call: the four (category, direction) queries are
    // merged into one answer, so each only needs half the limit — asking each for
    // the whole thing pulled four times the rows the caller can use, which is what
    // gets the shared endpoint to throttle us. And ask for what we'll keep: an
    // auto-trace wants 25 rows per node, and pulling 1000 for it burns latency its
    // wall-clock budget can't spare. A short page just means another page.
    const perQuery = Math.max(Math.ceil(opts.limit / 2), 25);
    const pageSize = Math.min(EvmProvider.NR_PAGE, Math.max(perQuery, 100));
    const maxCount = '0x' + pageSize.toString(16);

    // Each (category, direction) is paged on its own budget: querying native and
    // token rows together lets a busy native wallet crowd the token transfers out
    // of the first page — which is exactly what an analyst is looking for.
    for (const cat of category) {
      for (const dir of ['fromAddress', 'toAddress'] as const) {
        let pageKey: string | undefined;
        let kept = 0;
        for (let page = 0; page < EvmProvider.NR_MAX_PAGES; page++) {
          let res: { transfers: Array<Record<string, unknown>>; pageKey?: string };
          try {
            res = await this.nodeRealCall(url, {
              category: [cat], [dir]: address, maxCount, order: 'desc', ...(pageKey ? { pageKey } : {}),
            });
          } catch (e) { failed = (e as Error)?.message || String(e); break; }

          rowsSeen += res.transfers.length;
          for (const row of res.transfers) {
            const t = this.mapNodeRealTransfer(network, row);
            if (!t) continue;
            // The same tx shows up under both directions for a self-transfer, and a
            // multi-transfer tx yields several rows — key on the whole movement.
            const k = `${t.hash}|${t.from}|${t.to}|${row['value']}|${row['logIndex'] ?? ''}`;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(t);
            kept++;
          }
          pageKey = res.pageKey;
          if (!pageKey || res.transfers.length < pageSize || kept >= perQuery) break;
        }
      }
    }

    this.logger.log(`[NodeReal] ${network}: ${rowsSeen} rows → ${out.length} transfers${failed ? ` (ошибка: ${failed})` : ''}`);
    if (failed && !out.length) return { transfers: [], diag: `${network}: ${this.nodeRealDiag(failed)}`, status: 'down', source };
    return { transfers: out, diag: out.length ? null : failed, status: out.length ? 'ok' : 'empty', source };
  }

  private async fetchWalletTransfersScan(
    network: string, address: string, opts: { native: boolean; token: boolean; limit: number },
  ): Promise<WalletTransfersResult> {
    const scanBase = SCAN_HOSTS[network]!;
    const source = scanBase.replace(/^https?:\/\//, ''); // e.g. bscscan.com
    const out: TransferItem[] = [];
    let diag: string | null = null;
    const statuses: SourceStatus[] = [];

    if (opts.token) {
      const r = await this.fetchScanPaged(
        scanBase, `tokentxns?a=${address}`, network, 'token',
        (t) => (t.usdValue ?? 0) >= 1, opts.limit,
      );
      this.logger.log(`[Scan] ${network} token: ${r.parsed} parsed over ${r.pages} page(s), ${r.kept.length} kept (USD≥$1) [${r.status}]`);
      if (r.failed) diag = `${network}: не удалось загрузить токен-переводы с ${scanBase}`;
      statuses.push(r.status);
      out.push(...r.kept);
    }

    if (opts.native) {
      const r = await this.fetchScanPaged(
        scanBase, `txs?a=${address}`, network, 'native',
        (t) => (t.amount ?? 0) > 0, opts.limit,
      );
      this.logger.log(`[Scan] ${network} native: ${r.parsed} parsed over ${r.pages} page(s), ${r.kept.length} with value [${r.status}]`);
      if (r.failed) diag = `${network}: не удалось загрузить транзакции с ${scanBase}`;
      statuses.push(r.status);
      out.push(...r.kept);
    }

    const status = this.mergeStatus(statuses);
    if (status === 'drift') diag = `${network}: разметка ${source} изменилась — скрейпер устарел (0 распознано из непустой страницы)`;
    else if (status === 'down' && !diag) diag = `${network}: источник ${source} недоступен`;
    return { transfers: out, diag: out.length ? null : diag, status, source };
  }

  async fetchWalletTransfers(network: string, address: string, opts: { native: boolean; token: boolean; limit: number }): Promise<WalletTransfersResult> {
    const chainid = EVM_CHAINS[network];
    if (!chainid) return { transfers: [], diag: `unsupported EVM network: ${network}`, status: 'down', source: 'evm' };

    // Chains off the Etherscan free tier: NodeReal's indexed API where we have
    // one (BSC), else BscScan / BaseScan HTML scraping.
    if (network in NODEREAL_HOSTS) {
      const nr = await this.fetchWalletTransfersNodeReal(network, address, opts);
      if (nr.status !== 'down' || !(network in SCAN_HOSTS)) return nr;
      const scan = await this.fetchWalletTransfersScan(network, address, opts); // last resort
      return scan.transfers.length ? scan : nr;
    }
    if (network in SCAN_HOSTS) {
      return this.fetchWalletTransfersScan(network, address, opts);
    }

    const source = `etherscan:${network}`;
    const KEY = this.key();
    if (!KEY) return { transfers: [], diag: 'ETHERSCAN_API_KEY не задан на сервере (server/.env)', status: 'down', source };

    const out: TransferItem[] = [];
    let diag: string | null = null;
    const call = async (action: string) => {
      const url = `${EVM_BASE}?chainid=${chainid}&module=account&action=${action}&address=${address}&page=1&offset=${opts.limit}&sort=desc&apikey=${KEY}`;
      const j = await this.fetchJsonRetry(url);
      if (!Array.isArray(j['result'])) {
        diag = [j['message'], typeof j['result'] === 'string' ? j['result'] : ''].filter(Boolean).join(': ') || 'unexpected response';
        this.logger.warn(`[explorer] ${network}/${action} → ${diag}`);
        return [] as Array<Record<string, string>>;
      }
      return j['result'] as Array<Record<string, string>>;
    };

    if (opts.native) {
      for (const t of await call('txlist')) {
        out.push({ network, hash: t['hash'], from: t['from'], to: t['to'], amount: Number(BigInt(t['value'] || '0')) / 1e18, asset: this.nativeAsset(network), timestamp: Number(t['timeStamp']) * 1000 });
      }
    }
    if (opts.token) {
      for (const t of await call('tokentx')) {
        const dec = Number(t['tokenDecimal'] || 18);
        out.push({ network, hash: t['hash'], from: t['from'], to: t['to'], amount: Number(BigInt(t['value'] || '0')) / 10 ** dec, asset: t['tokenSymbol'] || '', timestamp: Number(t['timeStamp']) * 1000 });
      }
    }
    // The JSON API can't "drift" (no HTML to misparse) → ok / empty / down only.
    const status: SourceStatus = diag ? 'down' : out.length ? 'ok' : 'empty';
    return { transfers: out, diag: out.length ? null : diag, status, source };
  }

  // Native on-chain balance via public RPC (no API key needed).
  async fetchBalance(network: string, address: string): Promise<{ amount: number | null; asset: string; diag: string | null }> {
    const asset = this.nativeAsset(network);
    const rpc = PUBLIC_RPC[network];
    if (!rpc) return { amount: null, asset, diag: `unsupported EVM network: ${network}` };
    try {
      const hex = await this.rpcPost(rpc, 'eth_getBalance', [address, 'latest']) as string | null;
      if (hex == null) return { amount: null, asset, diag: `${network}: RPC вернул пустой ответ` };
      return { amount: Number(BigInt(hex)) / 1e18, asset, diag: null };
    } catch (e) {
      return { amount: null, asset, diag: String((e as Error)?.message || e) };
    }
  }

  private static readonly ERC20_BALANCEOF = '0x70a08231'; // balanceOf(address)

  // ERC-20 token balances: discover the token contracts this wallet has touched
  // (from its token-transfer history), then read balanceOf() on each via public
  // RPC. Best-effort and bounded — failures skip a token, never the whole call.
  async fetchTokenBalances(network: string, address: string): Promise<{ asset: string; amount: number }[]> {
    const rpc = PUBLIC_RPC[network];
    if (!rpc || !(network in EVM_CHAINS)) return [];
    const contracts = await this.discoverTokenContracts(network, address).catch(() => new Map());
    const entries = [...contracts.entries()].slice(0, 25);
    const padded = address.toLowerCase().replace('0x', '').padStart(64, '0');
    const out: { asset: string; amount: number }[] = [];
    await Promise.all(entries.map(async ([contract, info]) => {
      try {
        const balHex = await this.rpcPost(rpc, 'eth_call', [{ to: contract, data: EvmProvider.ERC20_BALANCEOF + padded }, 'latest']).catch(() => null) as string | null;
        if (!balHex || balHex === '0x' || /^0x0*$/.test(balHex)) return;
        let decimals = info.decimals;
        if (decimals == null || isNaN(decimals)) {
          const decHex = await this.rpcPost(rpc, 'eth_call', [{ to: contract, data: '0x313ce567' }, 'latest']).catch(() => null) as string | null;
          const d = decHex ? parseInt((decHex as string).replace('0x', ''), 16) : NaN;
          decimals = isNaN(d) ? 18 : d;
        }
        let symbol = info.symbol;
        if (!symbol) {
          const symHex = await this.rpcPost(rpc, 'eth_call', [{ to: contract, data: '0x95d89b41' }, 'latest']).catch(() => null) as string | null;
          symbol = this.decodeAbiString(symHex) || 'TOKEN';
        }
        const amount = Number(BigInt(balHex)) / 10 ** decimals;
        if (amount > 0) out.push({ asset: symbol, amount });
      } catch { /* skip this token */ }
    }));
    return out;
  }

  private async discoverTokenContracts(network: string, address: string): Promise<Map<string, { symbol?: string; decimals?: number }>> {
    const m = new Map<string, { symbol?: string; decimals?: number }>();
    // NodeReal chains (BSC): the token rows carry contract + symbol + decimals.
    if (network in NODEREAL_HOSTS) {
      const url = this.nodeRealUrl(network)!;
      for (const dir of ['fromAddress', 'toAddress'] as const) {
        try {
          const res = await this.nodeRealCall(url, { category: ['20'], [dir]: address, maxCount: '0x64', order: 'desc' });
          for (const r of res.transfers) {
            const c = String(r['contractAddress'] || '').toLowerCase();
            if (!c || m.has(c) || m.size >= 40) continue;
            const d = Number(r['decimal'] ?? 18);
            m.set(c, { symbol: (r['asset'] as string) || undefined, decimals: isNaN(d) ? undefined : d });
          }
        } catch { /* skip this direction */ }
      }
      return m;
    }
    // Scan-scraped chains (BASE): pull contract addresses from the token-tx page.
    if (network in SCAN_HOSTS) {
      const html = await this.fetchScanPage(`${SCAN_HOSTS[network]}/tokentxns?a=${address}&ps=100&p=1`, SCAN_HOSTS[network]);
      if (html) for (const mm of html.matchAll(/\/token\/(0x[0-9a-fA-F]{40})/g)) { if (m.size < 40) m.set(mm[1].toLowerCase(), {}); }
      return m;
    }
    // Etherscan-v2 chains: tokentx rows carry contractAddress + symbol + decimals.
    const chainid = EVM_CHAINS[network];
    const KEY = this.key();
    if (!KEY || !chainid) return m;
    const j = await this.fetchJsonRetry(`${EVM_BASE}?chainid=${chainid}&module=account&action=tokentx&address=${address}&page=1&offset=100&sort=desc&apikey=${KEY}`);
    if (Array.isArray(j['result'])) {
      for (const t of j['result'] as Array<Record<string, string>>) {
        const c = (t['contractAddress'] || '').toLowerCase();
        if (c && !m.has(c)) m.set(c, { symbol: t['tokenSymbol'], decimals: Number(t['tokenDecimal']) });
      }
    }
    return m;
  }

  isSupported(network: string): boolean {
    return network in EVM_CHAINS;
  }
}
