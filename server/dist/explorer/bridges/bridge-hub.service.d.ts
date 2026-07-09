import { OrbiterAdapter } from './orbiter.adapter';
import { DebridgeAdapter } from './debridge.adapter';
import { LifiAdapter } from './lifi.adapter';
import { AcrossAdapter } from './across.adapter';
import type { BridgeHop, BridgeResolveCtx } from './bridge-adapter.interface';
export interface BridgeInfo {
    id: string;
    name: string;
}
export declare class BridgeHubService {
    private readonly adapters;
    constructor(orbiter: OrbiterAdapter, debridge: DebridgeAdapter, lifi: LifiAdapter, across: AcrossAdapter);
    resolvers(): BridgeInfo[];
    has(id?: string | null): boolean;
    resolve(bridgeId: string, hash: string, ctx: BridgeResolveCtx): Promise<{
        hop: BridgeHop | null;
        outOfRange: boolean;
    }>;
    resolveAny(hash: string, ctx: BridgeResolveCtx): Promise<{
        hop: BridgeHop | null;
        outOfRange: boolean;
    }>;
}
