import { ConfigService } from '@nestjs/config';
import type { SourceStatus } from '../provider-health.service';
export interface TransferItem {
    network: string;
    hash: string;
    from: string | null;
    to: string | null;
    amount?: number;
    asset?: string;
    usdValue?: number;
    timestamp?: number;
    fromLabel?: string | null;
    toLabel?: string | null;
    transfers?: TransferItem[];
}
export interface WalletTransfersResult {
    transfers: TransferItem[];
    diag: string | null;
    status?: SourceStatus;
    source?: string;
}
export declare class EvmProvider {
    private readonly logger;
    private readonly key;
    constructor(cfg: ConfigService);
    private nativeAsset;
    private sleep;
    private rpcPost;
    private decodeAbiString;
    private fetchJsonRetry;
    private fetchExplorerHtmlLabel;
    private evmTxRpc;
    fetchTx(network: string, hash: string): Promise<TransferItem | null>;
    fetchAddressLabel(network: string, address: string): Promise<{
        label: string | null;
    }>;
    private fetchScanPage;
    private parseScanAmount;
    private parseScanUsd;
    private parseScanRows;
    private classifyScanPage;
    private mergeStatus;
    private static readonly SCAN_MAX_PAGES;
    private static readonly SCAN_PAGE_SIZE;
    private fetchScanPaged;
    private fetchWalletTransfersScan;
    fetchWalletTransfers(network: string, address: string, opts: {
        native: boolean;
        token: boolean;
        limit: number;
    }): Promise<WalletTransfersResult>;
    fetchBalance(network: string, address: string): Promise<{
        amount: number | null;
        asset: string;
        diag: string | null;
    }>;
    private static readonly ERC20_BALANCEOF;
    fetchTokenBalances(network: string, address: string): Promise<{
        asset: string;
        amount: number;
    }[]>;
    private discoverTokenContracts;
    isSupported(network: string): boolean;
}
