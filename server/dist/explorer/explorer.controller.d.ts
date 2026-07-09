import { ExplorerService } from './explorer.service';
import { BridgeRegistryService } from './bridge-registry.service';
import { BridgeHubService } from './bridges/bridge-hub.service';
import { ProviderHealthService } from './provider-health.service';
import { AddBridgeDto } from './dto/add-bridge.dto';
export declare class ExplorerController {
    private readonly explorer;
    private readonly bridges;
    private readonly bridgeHub;
    private readonly health;
    constructor(explorer: ExplorerService, bridges: BridgeRegistryService, bridgeHub: BridgeHubService, health: ProviderHealthService);
    sourceHealth(): {
        generatedAt: number;
        ok: boolean;
        degraded: string[];
        sources: import("./provider-health.service").SourceHealth[];
    };
    listResolvers(): import("./bridges/bridge-hub.service").BridgeInfo[];
    listBridges(): Promise<import("./entities/bridge-address.entity").BridgeAddress[]>;
    addBridge(dto: AddBridgeDto): Promise<import("./entities/bridge-address.entity").BridgeAddress>;
    removeBridge(address: string): Promise<{
        ok: boolean;
    }>;
    getTx(network: string, hash: string): Promise<{
        data: import("./providers/evm.provider").TransferItem | null;
        diag: string | null;
    }>;
    getLabel(network: string, address: string): Promise<{
        label: string | null;
        bridge?: string;
    }> | {
        label: null;
    };
    getWallet(network: string, address: string, native: string, token: string, limit: string, labels: string): Promise<{
        transfers: import("./providers/evm.provider").TransferItem[];
        diag: string | null;
        status?: import("./provider-health.service").SourceStatus;
    }> | {
        transfers: never[];
    };
    getBalance(network: string, address: string): Promise<{
        holdings: {
            asset: string;
            amount: number;
            usdValue: number | null;
        }[];
        totalUsd: number | null;
        diag: string | null;
    } | {
        amount: null;
        asset: string;
        usdValue: null;
        diag: string;
    }>;
    trace(network: string, address: string, direction: string, hops: string, minUsd: string, perNode: string): Promise<{
        transfers: import("./providers/evm.provider").TransferItem[];
        hops: import("./providers/orbiter.provider").OrbiterHop[];
        terminals: string[];
        stats: Record<string, number>;
        diag: string | null;
    }>;
    orbiterResolve(hash: string, chainId: string, ts: string, bridge: string): Promise<{
        hop: import("./providers/orbiter.provider").OrbiterHop | null;
        diag: string | null;
    }>;
    debridgeFeed(source: string, target: string, minUsd: string, since: string, limit: string): Promise<{
        hops: import("./providers/orbiter.provider").OrbiterHop[];
        diag: string | null;
    }>;
    orbiterFeed(source: string, target: string, minUsd: string, since: string, until: string, limit: string): Promise<{
        hops: import("./providers/orbiter.provider").OrbiterHop[];
        diag: string | null;
    }>;
}
