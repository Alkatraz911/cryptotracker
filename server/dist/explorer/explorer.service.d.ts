import { EvmProvider, TransferItem } from './providers/evm.provider';
import { TronProvider } from './providers/tron.provider';
import { SolanaProvider } from './providers/solana.provider';
import { OrbiterProvider, OrbiterHop } from './providers/orbiter.provider';
import { DebridgeProvider } from './providers/debridge.provider';
import { PriceProvider } from './providers/price.provider';
import { BridgeRegistryService } from './bridge-registry.service';
import { BridgeHubService } from './bridges/bridge-hub.service';
import { ProviderHealthService, SourceStatus } from './provider-health.service';
export type BridgeName = string;
export declare class ExplorerService {
    private readonly evm;
    private readonly tron;
    private readonly solana;
    private readonly orbiter;
    private readonly debridge;
    private readonly price;
    private readonly bridgeRegistry;
    private readonly bridges;
    private readonly health;
    private readonly logger;
    constructor(evm: EvmProvider, tron: TronProvider, solana: SolanaProvider, orbiter: OrbiterProvider, debridge: DebridgeProvider, price: PriceProvider, bridgeRegistry: BridgeRegistryService, bridges: BridgeHubService, health: ProviderHealthService);
    bridgeResolve(hash: string, chainId?: string, tsMs?: number, fast?: boolean, prefer?: BridgeName): Promise<{
        hop: OrbiterHop | null;
        outOfRange: boolean;
    }>;
    orbiterResolve(hash: string, chainId?: string, tsMs?: number, fast?: boolean, prefer?: BridgeName): Promise<{
        hop: OrbiterHop | null;
        outOfRange: boolean;
    }>;
    orbiterFeed(opts: {
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
    debridgeFeed(opts: {
        sourceChain?: string;
        targetChain?: string;
        minUsd?: number;
        sinceMs?: number;
        limit?: number;
    }): Promise<{
        hops: OrbiterHop[];
        diag: string | null;
    }>;
    fetchTx(network: string, hash: string): Promise<TransferItem | null>;
    fetchAddressLabel(network: string, address: string): Promise<{
        label: string | null;
        bridge?: string;
    }>;
    fetchBalance(network: string, address: string): Promise<{
        holdings: {
            asset: string;
            amount: number;
            usdValue: number | null;
        }[];
        totalUsd: number | null;
        diag: string | null;
    }>;
    fetchWalletTransfers(network: string, address: string, opts: {
        native: boolean;
        token: boolean;
        limit: number;
        labels?: boolean;
    }): Promise<{
        transfers: TransferItem[];
        diag: string | null;
        status?: SourceStatus;
    }>;
    private enrichUsd;
    traceFlow(opts: {
        network: string;
        address: string;
        direction?: 'out' | 'in';
        maxHops?: number;
        minUsd?: number;
        perNode?: number;
    }): Promise<{
        transfers: TransferItem[];
        hops: OrbiterHop[];
        terminals: string[];
        stats: Record<string, number>;
        diag: string | null;
    }>;
    private enrichLabels;
}
