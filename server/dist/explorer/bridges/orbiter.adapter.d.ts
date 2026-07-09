import { OrbiterProvider } from '../providers/orbiter.provider';
import type { BridgeAdapter, BridgeResolveCtx } from './bridge-adapter.interface';
export declare class OrbiterAdapter implements BridgeAdapter {
    private readonly provider;
    readonly id = "orbiter";
    readonly name = "Orbiter Finance";
    constructor(provider: OrbiterProvider);
    resolve(hash: string, ctx: BridgeResolveCtx): Promise<{
        hop: import("../providers/orbiter.provider").OrbiterHop | null;
        outOfRange: boolean;
    }>;
}
