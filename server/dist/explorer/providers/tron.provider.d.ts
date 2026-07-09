import { ConfigService } from '@nestjs/config';
import type { TransferItem } from './evm.provider';
export declare class TronProvider {
    private readonly logger;
    private readonly key;
    private accountCache;
    private static readonly ACCOUNT_TTL;
    constructor(cfg: ConfigService);
    private headers;
    private sleep;
    private fetchJson;
    private getAccount;
    fetchTx(hash: string): Promise<TransferItem | null>;
    private parseTx;
    fetchAddressLabel(address: string): Promise<{
        label: string | null;
    }>;
    fetchBalance(address: string): Promise<{
        amount: number | null;
        asset: string;
        diag: string | null;
    }>;
    fetchTokenBalances(address: string): Promise<{
        asset: string;
        amount: number;
    }[]>;
    fetchWalletTransfers(address: string, opts: {
        native: boolean;
        token: boolean;
        limit: number;
    }): Promise<{
        transfers: TransferItem[];
        diag: string | null;
    }>;
}
