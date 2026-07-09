import type { BridgeAdapter, BridgeHop, BridgeResolveCtx } from './bridge-adapter.interface';
export declare class AcrossAdapter implements BridgeAdapter {
    readonly id = "across";
    readonly name = "Across";
    private readonly logger;
    resolve(hash: string, ctx: BridgeResolveCtx): Promise<{
        hop: BridgeHop | null;
        outOfRange: boolean;
    }>;
    private getJson;
    private txSender;
}
