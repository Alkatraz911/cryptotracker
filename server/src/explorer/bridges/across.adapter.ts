import { Injectable, Logger } from '@nestjs/common';
import { ORBITER_CHAINS } from '../providers/orbiter.provider';
import type { BridgeAdapter, BridgeHop, BridgeResolveCtx } from './bridge-adapter.interface';

// Across is an intents bridge (SpokePool contracts per chain). We resolve a
// source deposit by hash via the public status API, then best-effort enrich the
// amount/recipient from the deposits list (keyed by depositor).
const ACROSS_STATUS = 'https://app.across.to/api/deposit/status';
const ACROSS_DEPOSITS = 'https://app.across.to/api/deposits';

// Across uses standard EVM chain ids (which match ORBITER_CHAINS) plus internal
// ids for non-EVM chains — map the ones we know to a net + explorer.
const ACROSS_CHAINS: Record<string, { name: string; net: string; tx: (h: string) => string }> = {
  '34268394551451': { name: 'Solana', net: 'SOLANA', tx: (h) => `https://solscan.io/tx/${h}` },
};
const chainDef = (id: string) => ORBITER_CHAINS[id] ?? ACROSS_CHAINS[id];

// Known bridged assets → { symbol, decimals } for amount display (Across moves
// mostly stablecoins / WETH). EVM addresses lowercased; Solana mints are base58
// and case-sensitive.
const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 },
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6 }, // Ethereum
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { symbol: 'USDC', decimals: 6 }, // Arbitrum
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 }, // Base
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': { symbol: 'USDC', decimals: 6 }, // Polygon
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { symbol: 'USDT', decimals: 18 }, // BSC (BSC-USD)
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6 }, // Ethereum
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', decimals: 18 }, // Ethereum
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { symbol: 'WETH', decimals: 18 }, // Arbitrum
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 }, // OP / Base
};
const tokenInfo = (a?: string) => (a ? TOKENS[a] ?? TOKENS[a.toLowerCase()] : undefined);

interface AcrossStatus {
  status?: string; depositId?: string; depositTxHash?: string;
  fillTx?: string; destinationChainId?: number;
}
interface AcrossDeposit {
  depositId?: string; depositTxHash?: string;
  originChainId?: number; destinationChainId?: number;
  depositor?: string; recipient?: string;
  inputToken?: string; inputAmount?: string;
  outputToken?: string; outputAmount?: string;
  outputPriceUsd?: string; depositBlockTimestamp?: string;
}

@Injectable()
export class AcrossAdapter implements BridgeAdapter {
  readonly id = 'across';
  readonly name = 'Across';
  private readonly logger = new Logger(AcrossAdapter.name);

  async resolve(hash: string, ctx: BridgeResolveCtx): Promise<{ hop: BridgeHop | null; outOfRange: boolean }> {
    const originChainId = ctx.chainId;
    if (!originChainId) return { hop: null, outOfRange: false }; // Across needs the source chain

    // 1) By-hash status: confirms an Across deposit and yields the destination fill tx.
    const status = await this.getJson<AcrossStatus>(
      `${ACROSS_STATUS}?originChainId=${originChainId}&depositTxHash=${hash}`,
    );
    if (
      !status ||
      status.depositTxHash?.toLowerCase() !== hash.toLowerCase() ||
      status.status !== 'filled' ||
      !status.fillTx ||
      status.destinationChainId == null
    ) {
      return { hop: null, outOfRange: false };
    }
    const srcChain = String(originChainId);
    const dstChain = String(status.destinationChainId);

    // 2) Enrich amount / symbol / recipient from the deposits list (best-effort).
    let amount = 0, symbol = '', usd = 0;
    let sourceTime = ctx.tsMs ?? Date.now();
    let sourceAddress: string | undefined;
    let targetWallet: string | undefined;
    try {
      const from = await this.txSender(srcChain, hash);
      if (from) {
        const list = await this.getJson<AcrossDeposit[]>(`${ACROSS_DEPOSITS}?depositor=${from}&limit=100`);
        const d = Array.isArray(list) ? list.find((x) => x.depositTxHash?.toLowerCase() === hash.toLowerCase()) : undefined;
        if (d) {
          sourceAddress = d.depositor ?? from;
          targetWallet = d.recipient ?? undefined;
          if (d.depositBlockTimestamp) sourceTime = Date.parse(d.depositBlockTimestamp) || sourceTime;
          const ti = tokenInfo(d.outputToken);
          if (ti && d.outputAmount != null) {
            amount = Number(d.outputAmount) / 10 ** ti.decimals;
            symbol = ti.symbol;
            usd = d.outputPriceUsd ? amount * Number(d.outputPriceUsd) : 0;
          }
        } else {
          sourceAddress = from;
        }
      }
    } catch (e) { this.logger.warn(`[Across] enrich failed: ${(e as Error)?.message}`); }

    const s = chainDef(srcChain), t = chainDef(dstChain);
    const hop: BridgeHop = {
      sourceId: hash, targetId: status.fillTx,
      sourceChain: srcChain, targetChain: dstChain,
      sourceChainName: s?.name ?? `chain ${srcChain}`,
      targetChainName: t?.name ?? `chain ${dstChain}`,
      sourceNet: s?.net ?? 'UNKNOWN', targetNet: t?.net ?? 'UNKNOWN',
      sourceTxUrl: s ? s.tx(hash) : '',
      targetTxUrl: t ? t.tx(status.fillTx) : '',
      amount, symbol, usd, sourceTime,
      sourceAddress, targetWallet,
    };
    this.logger.log(`[Across] match ${srcChain}→${dstChain}${symbol ? ` ${amount} ${symbol}` : ''}`);
    return { hop, outOfRange: false };
  }

  private async getJson<T>(url: string): Promise<T | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
      if (!r.ok) return null;
      return await r.json() as T;
    } catch { return null; } finally { clearTimeout(timer); }
  }

  // Source-tx sender via the chain's public RPC — needed to query the deposits
  // list (which is keyed by depositor).
  private async txSender(chainId: string, hash: string): Promise<string | null> {
    const rpc = ORBITER_CHAINS[chainId]?.rpc;
    if (!rpc) return null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [hash] }),
        signal: ac.signal,
      });
      const j = await r.json() as { result?: { from?: string } | null };
      return j.result?.from ?? null;
    } catch { return null; } finally { clearTimeout(timer); }
  }
}
