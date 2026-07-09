import type { OrbiterHop } from './orbiter.provider';
interface ChainDef {
    name: string;
    net: string;
    tx: (h: string) => string;
}
export declare const DEBRIDGE_CHAINS: Record<string, ChainDef>;
export declare const NET_TO_DEBRIDGE: Record<string, string>;
export declare class DebridgeProvider {
    private readonly logger;
    chainName(id: string): string;
    private getJson;
    private postJson;
    private amount;
    private orderToHop;
    resolve(hash: string): Promise<OrbiterHop | null>;
    feed(opts: {
        sourceChain?: string;
        targetChain?: string;
        minUsd?: number;
        sinceMs?: number;
        limit?: number;
    }): Promise<{
        hops: OrbiterHop[];
        diag: string | null;
    }>;
}
export {};
