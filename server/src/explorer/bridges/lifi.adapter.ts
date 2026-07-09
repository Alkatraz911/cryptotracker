import { Injectable, Logger } from '@nestjs/common';
import { ORBITER_CHAINS } from '../providers/orbiter.provider';
import type { BridgeAdapter, BridgeHop } from './bridge-adapter.interface';

// LI.FI is a cross-chain AGGREGATOR: one status API covers the many bridges it
// routes (Stargate, Across, Hop, cBridge, …). We resolve by source tx hash.
//
// IMPORTANT: the status endpoint returns a stale example for unknown hashes, so
// we accept a result only when sending.txHash matches the queried hash, the
// transfer is DONE, and it is genuinely cross-chain.
const LIFI_STATUS = 'https://li.quest/v1/status';

interface LifiSide {
  txHash?: string; txLink?: string; chainId?: number;
  amount?: string; amountUSD?: string; timestamp?: number;
  token?: { symbol?: string; decimals?: number };
}
interface LifiStatus {
  status?: string;
  sending?: LifiSide; receiving?: LifiSide;
  fromAddress?: string; toAddress?: string;
}

@Injectable()
export class LifiAdapter implements BridgeAdapter {
  readonly id = 'lifi';
  readonly name = 'LI.FI';
  private readonly logger = new Logger(LifiAdapter.name);

  async resolve(hash: string): Promise<{ hop: BridgeHop | null; outOfRange: boolean }> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    try {
      const r = await fetch(`${LIFI_STATUS}?txHash=${encodeURIComponent(hash)}`, { signal: ac.signal });
      if (!r.ok) return { hop: null, outOfRange: false };
      const d = await r.json() as LifiStatus;
      const send = d.sending, recv = d.receiving;

      // Guards: only a completed transfer whose SOURCE matches our hash, and
      // which actually crosses chains (LI.FI also routes same-chain swaps).
      if (d.status !== 'DONE' || !send?.txHash || !recv?.txHash) return { hop: null, outOfRange: false };
      if (send.txHash.toLowerCase() !== hash.toLowerCase()) return { hop: null, outOfRange: false };
      if (send.chainId == null || recv.chainId == null || send.chainId === recv.chainId) return { hop: null, outOfRange: false };

      const srcChain = String(send.chainId), dstChain = String(recv.chainId);
      const sdef = ORBITER_CHAINS[srcChain], tdef = ORBITER_CHAINS[dstChain];
      const dec = recv.token?.decimals ?? 18;
      const amount = recv.amount != null ? Number(recv.amount) / 10 ** dec : 0;

      const hop: BridgeHop = {
        sourceId: send.txHash, targetId: recv.txHash,
        sourceChain: srcChain, targetChain: dstChain,
        sourceChainName: sdef?.name ?? `chain ${srcChain}`,
        targetChainName: tdef?.name ?? `chain ${dstChain}`,
        sourceNet: sdef?.net ?? 'UNKNOWN', targetNet: tdef?.net ?? 'UNKNOWN',
        sourceTxUrl: send.txLink ?? (sdef ? sdef.tx(send.txHash) : ''),
        targetTxUrl: recv.txLink ?? (tdef ? tdef.tx(recv.txHash) : ''),
        amount, symbol: recv.token?.symbol ?? send.token?.symbol ?? '',
        usd: Number(recv.amountUSD) || Number(send.amountUSD) || 0,
        sourceTime: send.timestamp ? send.timestamp * 1000 : Date.now(),
        sourceAddress: d.fromAddress, targetWallet: d.toAddress,
      };
      this.logger.log(`[LI.FI] match ${srcChain}→${dstChain}`);
      return { hop, outOfRange: false };
    } catch (e) {
      this.logger.warn(`[LI.FI] ${(e as Error)?.message}`);
      return { hop: null, outOfRange: false };
    } finally { clearTimeout(timer); }
  }
}
