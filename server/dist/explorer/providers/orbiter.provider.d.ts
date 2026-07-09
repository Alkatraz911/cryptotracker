import { ConfigService } from '@nestjs/config';
interface ChainDef {
    name: string;
    net: string;
    rpc: string | null;
    tx: (h: string) => string;
}
export declare const ORBITER_CHAINS: Record<string, ChainDef>;
export interface OrbiterRow {
    status: number;
    sourceId: string;
    targetId: string;
    sourceChain: string;
    targetChain: string;
    sourceAmount: string;
    sourceSymbol: string;
    sourceTime: string;
    sourceAmountUSD: string;
}
export interface OrbiterHop {
    sourceId: string;
    targetId: string;
    sourceChain: string;
    targetChain: string;
    sourceChainName: string;
    targetChainName: string;
    sourceNet: string;
    targetNet: string;
    sourceTxUrl: string;
    targetTxUrl: string;
    amount: number;
    symbol: string;
    usd: number;
    sourceTime: number;
    sourceAddress?: string;
    targetWallet?: string;
}
export declare class OrbiterProvider {
    private readonly cfg;
    private readonly logger;
    constructor(cfg: ConfigService);
    private indexerUrl;
    chainName(chainId: string): string;
    private fetchIndexer;
    private indexerBridgeToHop;
    private toHop;
    private lookupToHop;
    private lookupTx;
    private fetchPage;
    private rpc;
    blockTime(chainId: string, hash: string): Promise<number | null>;
    private static readonly MAX_PAGE;
    private static readonly FETCH_BUDGET;
    private static newest;
    private static oldest;
    private locatePage;
    private pageGetter;
    private searchFeed;
    resolve(hash: string, chainId?: string, tsMs?: number, fast?: boolean): Promise<{
        hop: OrbiterHop | null;
        outOfRange: boolean;
    }>;
    feed(opts: {
        sourceChain: string;
        targetChain?: string;
        minUsd?: number;
        sinceMs?: number;
        untilMs?: number;
        limit?: number;
    }): Promise<{
        hops: OrbiterHop[];
        diag: string | null;
    }>;
}
export {};
