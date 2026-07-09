import { ConfigService } from '@nestjs/config';
import type { TransferItem } from './evm.provider';
export declare class SolanaProvider {
    private readonly logger;
    private readonly key;
    private readonly heliusKey;
    constructor(cfg: ConfigService);
    private rpcEndpoints;
    fetchTx(hash: string): Promise<TransferItem | null>;
    private fetchTxPro;
    private fetchTxRpc;
    private parseRpcTx;
    private fetchTxLegacy;
    fetchAddressLabel(address: string): Promise<{
        label: string | null;
    }>;
    private fetchOkxLabel;
    fetchWalletTransfers(address: string, opts: {
        native: boolean;
        token: boolean;
        limit: number;
    }): Promise<{
        transfers: TransferItem[];
        diag: string | null;
    }>;
    private fetchWalletTransfersHelius;
    private fetchWalletTransfersPro;
    fetchBalance(address: string): Promise<{
        amount: number | null;
        asset: string;
        diag: string | null;
    }>;
    fetchTokenBalances(address: string): Promise<{
        asset: string;
        amount: number;
    }[]>;
    private rpcCall;
    private fetchWalletTransfersRpc;
}
