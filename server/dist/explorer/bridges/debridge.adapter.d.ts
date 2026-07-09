import { DebridgeProvider } from '../providers/debridge.provider';
import type { BridgeAdapter } from './bridge-adapter.interface';
export declare class DebridgeAdapter implements BridgeAdapter {
    private readonly provider;
    readonly id = "debridge";
    readonly name = "deBridge";
    constructor(provider: DebridgeProvider);
    resolve(hash: string): Promise<{
        hop: import("../providers/orbiter.provider").OrbiterHop | null;
        outOfRange: boolean;
    }>;
}
