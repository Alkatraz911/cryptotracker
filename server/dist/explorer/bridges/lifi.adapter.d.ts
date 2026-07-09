import type { BridgeAdapter, BridgeHop } from './bridge-adapter.interface';
export declare class LifiAdapter implements BridgeAdapter {
    readonly id = "lifi";
    readonly name = "LI.FI";
    private readonly logger;
    resolve(hash: string): Promise<{
        hop: BridgeHop | null;
        outOfRange: boolean;
    }>;
}
