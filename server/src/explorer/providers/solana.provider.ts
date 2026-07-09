import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TransferItem } from './evm.provider';

const SOLSCAN_PRO     = 'https://pro-api.solscan.io/v2.0';
const SOLSCAN_LEGACY  = 'https://public-api.solscan.io';

// Public Solana RPC endpoints tried in order (no API key needed).
const SOLANA_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
];

// Common SPL mints → ticker (Helius enhanced API gives mint, not symbol).
const MINT_SYMBOLS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  So11111111111111111111111111111111111111112: 'SOL',
};

@Injectable()
export class SolanaProvider {
  private readonly logger = new Logger(SolanaProvider.name);
  private readonly key: () => string;
  private readonly heliusKey: () => string;

  constructor(cfg: ConfigService) {
    this.key = () => cfg.get<string>('SOLSCAN_API_KEY', '');
    this.heliusKey = () => cfg.get<string>('HELIUS_API_KEY', '');
  }

  // Helius RPC (prepended when a key is set — far higher rate limits than public).
  private rpcEndpoints(): string[] {
    const h = this.heliusKey();
    return h ? [`https://mainnet.helius-rpc.com/?api-key=${h}`, ...SOLANA_RPCS] : [...SOLANA_RPCS];
  }

  // ── fetchTx ─────────────────────────────────────────────────────────────────

  async fetchTx(hash: string): Promise<TransferItem | null> {
    const KEY = this.key();
    try {
      if (KEY) {
        const pro = await this.fetchTxPro(hash, KEY);
        if (pro) return pro;
        this.logger.warn(`fetchTxPro returned null for ${hash.slice(0, 20)}… — falling back to RPC`);
      }

      // Try RPCs (Helius first if configured, then public)
      for (const rpc of this.rpcEndpoints()) {
        const r = await this.fetchTxRpc(rpc, hash);
        if (r) return r;
      }
      return await this.fetchTxLegacy(hash);
    } catch (e) {
      this.logger.error(`fetchTx ${hash}: ${(e as Error)?.message}`);
      return null;
    }
  }

  private async fetchTxPro(hash: string, key: string): Promise<TransferItem | null> {
    const r = await fetch(`${SOLSCAN_PRO}/transaction/detail?tx=${hash}`, {
      headers: { token: key },
    });
    if (!r.ok) {
      this.logger.warn(`[SolscanPro] HTTP ${r.status} for tx ${hash.slice(0, 20)}…`);
      return null;
    }
    const j = await r.json() as Record<string, unknown>;
    const d = j['data'] as Record<string, unknown> | null;
    if (!d) {
      this.logger.warn(`[SolscanPro] data=null, success=${j['success']}`);
      return null;
    }
    const instr = (d['parsed_instructions'] as Array<Record<string, unknown>>)?.[0];
    const params = instr?.['params'] as Record<string, unknown> | undefined;
    return {
      network: 'SOLANA', hash,
      from: (d['signer'] as string[])?.[0] ?? null,
      to:   (params?.['destination'] as string) ?? null,
      amount: params?.['amount'] != null ? Number(params['amount']) / 1e9 : undefined,
      asset: 'SOL',
    };
  }

  private async fetchTxRpc(rpc: string, hash: string): Promise<TransferItem | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    try {
      this.logger.log(`[RPC] → ${rpc.replace('https://', '')}`);
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getTransaction',
          params: [hash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }],
        }),
        signal: ac.signal,
      });
      this.logger.log(`[RPC] ← HTTP ${r.status}`);
      if (!r.ok) {
        this.logger.warn(`[RPC] non-OK HTTP ${r.status} from ${rpc}`);
        return null;
      }
      const j = await r.json() as Record<string, unknown>;
      if (j['error']) {
        this.logger.warn(`[RPC] JSON-RPC error: ${JSON.stringify(j['error'])}`);
        return null;
      }
      const tx = j['result'] as Record<string, unknown> | null;
      if (!tx) {
        this.logger.warn(`[RPC] result=null — tx not found or not confirmed`);
        return null;
      }
      const item = this.parseRpcTx(hash, tx);
      const bt = tx['blockTime'];
      if (bt) item.timestamp = Number(bt) * 1000;
      this.logger.log(`[RPC] OK — from=${item.from?.slice(0, 12)}… to=${item.to?.slice(0, 12) ?? 'null'} asset=${item.asset}`);
      return item;
    } catch (e) {
      this.logger.error(`[RPC] exception: ${(e as Error)?.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private parseRpcTx(hash: string, tx: Record<string, unknown>): TransferItem {
    const msg     = (tx['transaction'] as Record<string, unknown>)?.['message'] as Record<string, unknown>;
    const keys    = (msg?.['accountKeys'] ?? []) as Array<{ pubkey: string }>;
    const defaultFrom = keys[0]?.pubkey ?? null;

    // Collect all instructions: top-level + inner (transfers often live in innerInstructions)
    const topLevel = (msg?.['instructions'] ?? []) as Array<Record<string, unknown>>;
    const innerGroups = ((tx['meta'] as Record<string, unknown>)?.['innerInstructions'] ?? []) as
      Array<{ instructions: Array<Record<string, unknown>> }>;
    const allIx = [...topLevel, ...innerGroups.flatMap((g) => g.instructions)];

    for (const ix of allIx) {
      const parsed = ix['parsed'] as Record<string, unknown> | undefined;
      const info   = parsed?.['info']  as Record<string, unknown> | undefined;
      if (!parsed || !info) continue;

      if (ix['program'] === 'system' && parsed['type'] === 'transfer') {
        return {
          network: 'SOLANA', hash,
          from:   info['source']      as string || defaultFrom,
          to:     info['destination'] as string || null,
          amount: Number(info['lamports']) / 1e9,
          asset:  'SOL',
        };
      }

      if (ix['program'] === 'spl-token' &&
          (parsed['type'] === 'transferChecked' || parsed['type'] === 'transfer')) {
        const ta = info['tokenAmount'] as Record<string, unknown> | undefined;
        // 'transfer' gives raw amount without decimals; 'transferChecked' gives tokenAmount.uiAmount
        const amount = ta?.['uiAmount'] != null
          ? Number(ta['uiAmount'])
          : undefined;
        return {
          network: 'SOLANA', hash,
          from:   info['authority'] as string || info['source'] as string || defaultFrom,
          to:     info['destination'] as string || null,
          amount,
          asset: 'SPL',
        };
      }
    }

    // No recognised transfer instruction — return signer only
    return { network: 'SOLANA', hash, from: defaultFrom, to: null, amount: undefined, asset: 'SOL' };
  }

  private async fetchTxLegacy(hash: string): Promise<TransferItem | null> {
    try {
      const r = await fetch(`${SOLSCAN_LEGACY}/transaction?signature=${hash}`);
      if (!r.ok) return null;
      const j = await r.json() as Record<string, unknown>;
      // Legacy API returns signer array and basic tx info
      const from = (j['signer'] as string[])?.[0] ?? null;
      if (!from) return null;
      return { network: 'SOLANA', hash, from, to: null, amount: undefined, asset: 'SOL' };
    } catch { return null; }
  }

  // ── fetchAddressLabel ────────────────────────────────────────────────────────

  async fetchAddressLabel(address: string): Promise<{ label: string | null }> {
    // OKX Web3 explorer carries CEX/entity tags for Solana accounts too — and
    // needs no key. Solscan's own label endpoint is Pro-only (the free tier 401s),
    // so OKX is the primary source; a paid Solscan key is a fallback.
    const okx = await this.fetchOkxLabel(address);
    if (okx) return { label: okx };

    const KEY = this.key();
    if (KEY) {
      try {
        const r = await fetch(`${SOLSCAN_PRO}/account/detail?address=${address}`, { headers: { token: KEY } });
        if (r.ok) {
          const j = await r.json() as Record<string, unknown>;
          const data = j['data'] as Record<string, unknown> | null;
          const lbl = data?.['label'] ?? (data?.['account_label'] as Record<string, unknown>)?.['label'];
          if (lbl) return { label: lbl as string };
        }
      } catch { /* fall through */ }
    }
    return { label: null };
  }

  // Scrape OKX Web3 explorer for a Solana account's entity tag (exchange, etc.).
  // Solana pages live under /account/ (EVM uses /address/); the tag sits in the
  // same server-rendered hoverEntityTag / entityTag fields as the EVM pages.
  private async fetchOkxLabel(address: string): Promise<string | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(`https://web3.okx.com/explorer/sol/account/${address}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: ac.signal,
      });
      if (!r.ok) return null;
      const html = await r.text();
      const m1 = html.match(/"hoverEntityTag"\s*:\s*"([^"]{2,100})"/);
      if (m1?.[1]) return m1[1];
      const m2 = html.match(/"entityTag"\s*:\s*"([^"]{2,100})"/);
      if (m2?.[1]) return m2[1];
      return null;
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  // ── fetchWalletTransfers ─────────────────────────────────────────────────────

  async fetchWalletTransfers(
    address: string,
    opts: { native: boolean; token: boolean; limit: number },
  ): Promise<{ transfers: TransferItem[]; diag: string | null }> {
    // Helius enhanced API first — parsed transfers with OWNER addresses + amounts.
    if (this.heliusKey()) {
      const h = await this.fetchWalletTransfersHelius(address, opts);
      if (h.transfers.length) return h;
      this.logger.warn(`Helius returned no transfers (${h.diag ?? 'empty'}) — trying other sources`);
    }
    const KEY = this.key();
    // Solscan Pro (works on paid tiers — richer data incl. token symbols).
    if (KEY) {
      const pro = await this.fetchWalletTransfersPro(address, opts, KEY);
      if (pro.transfers.length) return pro;
      this.logger.warn('Solscan Pro returned no wallet data (free-tier key blocks it) — falling back to public RPC');
    }
    // Free fallback: reconstruct history from RPC (Helius RPC if key, else public).
    return this.fetchWalletTransfersRpc(address, opts);
  }

  // Helius "Parsed Transaction History" — returns owner wallets (not token
  // accounts), native + token transfers with decimal amounts. Free-tier friendly.
  private async fetchWalletTransfersHelius(
    address: string,
    opts: { native: boolean; token: boolean; limit: number },
  ): Promise<{ transfers: TransferItem[]; diag: string | null }> {
    const KEY = this.heliusKey();
    const want = Math.max(opts.limit, 1);            // total transfers desired
    const out: TransferItem[] = [];
    let before = '';
    let txCount = 0;
    let diag: string | null = null;

    // Helius returns ≤100 txs/page; page with the `before` cursor until we have
    // enough transfers, the page is short, or a safety cap is hit.
    for (let page = 0; page < 30 && out.length < want; page++) {
      const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${KEY}&limit=100${before ? `&before=${before}` : ''}`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 15000);
      let arr: Array<Record<string, unknown>>;
      try {
        const r = await fetch(url, { signal: ac.signal });
        if (!r.ok) { diag = `Helius HTTP ${r.status}`; break; }
        arr = await r.json() as Array<Record<string, unknown>>;
      } catch (e) { diag = `Helius: ${(e as Error)?.message}`; break; }
      finally { clearTimeout(timer); }
      if (!Array.isArray(arr) || !arr.length) break;
      txCount += arr.length;

      for (const tx of arr) {
        const sig = tx['signature'] as string;
        const ts = tx['timestamp'] ? Number(tx['timestamp']) * 1000 : undefined;
        if (opts.native) {
          for (const n of (tx['nativeTransfers'] ?? []) as Array<Record<string, unknown>>) {
            const amount = Number(n['amount']) / 1e9;
            if (!amount) continue;
            out.push({
              network: 'SOLANA', hash: sig,
              from: (n['fromUserAccount'] as string) || null, to: (n['toUserAccount'] as string) || null,
              amount, asset: 'SOL', timestamp: ts,
            });
          }
        }
        if (opts.token) {
          for (const t of (tx['tokenTransfers'] ?? []) as Array<Record<string, unknown>>) {
            const amount = Number(t['tokenAmount']) || 0;
            out.push({
              network: 'SOLANA', hash: sig,
              from: (t['fromUserAccount'] as string) || null, to: (t['toUserAccount'] as string) || null,
              amount, asset: MINT_SYMBOLS[t['mint'] as string] || 'SPL', timestamp: ts,
            });
          }
        }
      }
      before = arr[arr.length - 1]['signature'] as string;
      if (arr.length < 100) break; // last page
    }

    this.logger.log(`[Helius] wallet ${address.slice(0, 8)}…: ${txCount} txs → ${out.length} transfers`);
    return { transfers: out, diag: out.length ? null : (diag ?? 'Helius: переводы не найдены') };
  }

  private async fetchWalletTransfersPro(
    address: string,
    opts: { native: boolean; token: boolean; limit: number },
    KEY: string,
  ): Promise<{ transfers: TransferItem[]; diag: string | null }> {
    // Solscan v2 only accepts these page sizes.
    const PS = [10, 20, 30, 40, 60, 100];
    const pageSize = PS.find((p) => p >= opts.limit) ?? 100;
    const out: TransferItem[] = [];
    let diag: string | null = null;
    const headers = { token: KEY };
    const pull = async (activity: string, native: boolean) => {
      const r = await fetch(
        `${SOLSCAN_PRO}/account/transfer?address=${address}&page=1&page_size=${pageSize}` +
        `&exclude_amount_zero=true&activity_type[]=${activity}`,
        { headers },
      );
      const j = await r.json() as Record<string, unknown>;
      if (!r.ok || j['success'] === false) {
        diag = `Solscan: ${(j['errors'] as Record<string, unknown>)?.['message'] ?? `HTTP ${r.status}`}`;
        return;
      }
      for (const t of (j['data'] ?? []) as Array<Record<string, unknown>>) {
        const dec = native ? 9 : Number(t['token_decimals'] || 0);
        const amount = Number(t['amount']) / Math.pow(10, dec);
        out.push({
          network: 'SOLANA', hash: t['trans_id'] as string,
          from: t['from_address'] as string, to: t['to_address'] as string,
          amount, asset: native ? 'SOL' : (t['token_symbol'] || 'SPL') as string,
          timestamp: Number(t['block_time']) * 1000,
        });
      }
    };
    try {
      if (opts.token) await pull('ACTIVITY_SPL_TRANSFER', false);
      if (opts.native) await pull('ACTIVITY_SOL_TRANSFER', true);
    } catch (e) { diag = String((e as Error)?.message || e); }
    return { transfers: out, diag: out.length ? null : diag };
  }

  // Native SOL balance via RPC getBalance (Helius if keyed, else public).
  async fetchBalance(address: string): Promise<{ amount: number | null; asset: string; diag: string | null }> {
    for (const rpc of this.rpcEndpoints()) {
      const res = await this.rpcCall(rpc, 'getBalance', [address]);
      if (res == null) continue;
      const lamports = typeof res === 'object' && res !== null && 'value' in (res as Record<string, unknown>)
        ? Number((res as Record<string, unknown>)['value'])
        : Number(res);
      if (!Number.isNaN(lamports)) return { amount: lamports / 1e9, asset: 'SOL', diag: null };
    }
    return { amount: null, asset: 'SOL', diag: 'SOLANA: публичный RPC недоступен (getBalance).' };
  }

  // SPL token balances via getTokenAccountsByOwner (jsonParsed).
  async fetchTokenBalances(address: string): Promise<{ asset: string; amount: number }[]> {
    const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    for (const rpc of this.rpcEndpoints()) {
      const res = await this.rpcCall(rpc, 'getTokenAccountsByOwner',
        [address, { programId: SPL_TOKEN_PROGRAM }, { encoding: 'jsonParsed' }]);
      const value = (res as Record<string, unknown>)?.['value'] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(value)) continue;
      const out: { asset: string; amount: number }[] = [];
      for (const acc of value) {
        const data = (acc['account'] as Record<string, unknown>)?.['data'] as Record<string, unknown> | undefined;
        const info = ((data?.['parsed'] as Record<string, unknown>)?.['info']) as Record<string, unknown> | undefined;
        const mint = info?.['mint'] as string | undefined;
        const ta = info?.['tokenAmount'] as Record<string, unknown> | undefined;
        const amount = ta?.['uiAmount'] != null ? Number(ta['uiAmount']) : 0;
        if (amount > 0 && mint) out.push({ asset: MINT_SYMBOLS[mint] || `${mint.slice(0, 4)}…${mint.slice(-4)}`, amount });
      }
      return out.slice(0, 25);
    }
    return [];
  }

  // ── RPC fallback: reconstruct wallet history without a key ────────────────────
  private async rpcCall(rpc: string, method: string, params: unknown[]): Promise<unknown> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    try {
      const r = await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ac.signal,
      });
      if (!r.ok) return null;
      const j = await r.json() as { error?: unknown; result?: unknown };
      return j.error ? null : (j.result ?? null);
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  private async fetchWalletTransfersRpc(
    address: string,
    opts: { native: boolean; token: boolean; limit: number },
  ): Promise<{ transfers: TransferItem[]; diag: string | null }> {
    const limit = Math.min(opts.limit, 40);

    // Find an RPC that answers getSignaturesForAddress.
    type Sig = { signature: string; blockTime?: number };
    let sigs: Sig[] | null = null;
    let rpc = '';
    for (const candidate of this.rpcEndpoints()) {
      const r = await this.rpcCall(candidate, 'getSignaturesForAddress', [address, { limit }]);
      if (Array.isArray(r)) { sigs = r as Sig[]; rpc = candidate; break; }
    }
    if (!sigs) return { transfers: [], diag: 'SOLANA: публичный RPC недоступен (getSignaturesForAddress).' };
    if (!sigs.length) return { transfers: [], diag: 'SOLANA: транзакции для адреса не найдены.' };

    this.logger.log(`[RPC] wallet ${address.slice(0, 8)}…: ${sigs.length} signatures via ${rpc.replace('https://', '')}`);

    // Fetch + parse each tx in small concurrent batches (public RPC rate-limits).
    const out: TransferItem[] = [];
    const POOL = 4;
    for (let i = 0; i < sigs.length; i += POOL) {
      const batch = sigs.slice(i, i + POOL);
      const items = await Promise.all(batch.map(async (s) => {
        const tx = await this.rpcCall(rpc, 'getTransaction',
          [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
        if (!tx) return null;
        const item = this.parseRpcTx(s.signature, tx as Record<string, unknown>);
        const bt = (tx as Record<string, unknown>)['blockTime'] ?? s.blockTime;
        item.timestamp = bt ? Number(bt) * 1000 : undefined;
        return item;
      }));
      for (const it of items) {
        if (!it || (!it.from && !it.to)) continue;
        const isNative = it.asset === 'SOL';
        if (isNative && !opts.native) continue;
        if (!isNative && !opts.token) continue;
        out.push(it);
      }
    }
    return { transfers: out, diag: out.length ? null : 'SOLANA: переводы не распознаны в транзакциях кошелька.' };
  }
}
