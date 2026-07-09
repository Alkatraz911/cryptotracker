import type { OrbiterHop } from '../providers/orbiter.provider';
export type BridgeHop = OrbiterHop;
export interface BridgeResolveCtx {
    chainId?: string;
    tsMs?: number;
    fast?: boolean;
}
export interface BridgeAdapter {
    readonly id: string;
    readonly name: string;
    resolve(hash: string, ctx: BridgeResolveCtx): Promise<{
        hop: BridgeHop | null;
        outOfRange: boolean;
    }>;
}
