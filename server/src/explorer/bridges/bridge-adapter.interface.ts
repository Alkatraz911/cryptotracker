import type { OrbiterHop } from '../providers/orbiter.provider';

// Unified cross-chain hop shape (source tx ↔ target tx + chains/amount), shared
// by every bridge adapter. Reuses OrbiterHop, which the frontend already renders.
export type BridgeHop = OrbiterHop;

export interface BridgeResolveCtx {
  chainId?: string; // source chain id (helps some resolvers)
  tsMs?: number;    // source tx time (ms) — seeds time-based lookups
  fast?: boolean;   // skip slow fallbacks (used by auto-trace over many hashes)
}

// A pluggable bridge integration. `resolve` correlates a source tx hash to its
// cross-chain counterpart on the destination chain. Adding a bridge = adding an
// adapter (for resolution) + registry addresses (for detection).
export interface BridgeAdapter {
  readonly id: string;   // slug, e.g. 'orbiter' | 'debridge' | 'lifi'
  readonly name: string; // display name
  resolve(hash: string, ctx: BridgeResolveCtx): Promise<{ hop: BridgeHop | null; outOfRange: boolean }>;
}
