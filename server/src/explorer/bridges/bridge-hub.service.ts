import { Injectable } from '@nestjs/common';
import { OrbiterAdapter } from './orbiter.adapter';
import { DebridgeAdapter } from './debridge.adapter';
import { LifiAdapter } from './lifi.adapter';
import { AcrossAdapter } from './across.adapter';
import type { BridgeAdapter, BridgeHop, BridgeResolveCtx } from './bridge-adapter.interface';

export interface BridgeInfo { id: string; name: string }

// Registry + dispatcher for bridge adapters. Adding a resolvable bridge = add an
// adapter here. Detection-only bridges live purely in the address registry and
// simply won't have an adapter (no cross-chain resolve button).
@Injectable()
export class BridgeHubService {
  private readonly adapters = new Map<string, BridgeAdapter>();

  constructor(orbiter: OrbiterAdapter, debridge: DebridgeAdapter, lifi: LifiAdapter, across: AcrossAdapter) {
    for (const a of [orbiter, debridge, lifi, across] as BridgeAdapter[]) this.adapters.set(a.id, a);
  }

  // Bridges that support cross-chain resolution (drives the frontend button).
  resolvers(): BridgeInfo[] {
    return [...this.adapters.values()].map((a) => ({ id: a.id, name: a.name }));
  }

  has(id?: string | null): boolean {
    return !!id && this.adapters.has(id);
  }

  // Resolve via a SPECIFIC bridge (exclusive — no probing others).
  async resolve(bridgeId: string, hash: string, ctx: BridgeResolveCtx): Promise<{ hop: BridgeHop | null; outOfRange: boolean }> {
    const a = this.adapters.get(bridgeId);
    if (!a) return { hop: null, outOfRange: false };
    return a.resolve(hash, ctx);
  }

  // Probe every adapter in parallel (used when the bridge is unknown, e.g.
  // unlabelled auto-trace). First hop wins; outOfRange if any reported it.
  async resolveAny(hash: string, ctx: BridgeResolveCtx): Promise<{ hop: BridgeHop | null; outOfRange: boolean }> {
    const results = await Promise.all([...this.adapters.values()].map((a) => a.resolve(hash, ctx).catch(() => ({ hop: null, outOfRange: false }))));
    const hit = results.find((r) => r.hop);
    if (hit) return hit;
    return { hop: null, outOfRange: results.some((r) => r.outOfRange) };
  }
}
