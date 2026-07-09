import { Repository } from 'typeorm';
import { ExplorerService } from '../explorer/explorer.service';
import type { TransferItem } from '../explorer/providers/evm.provider';
import type { SourceStatus } from '../explorer/provider-health.service';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';
export interface WalletTxOpts {
    native: boolean;
    token: boolean;
    limit: number;
    force?: boolean;
    fromMs?: number;
    toMs?: number;
    asset?: string;
}
export declare class ChainDataService {
    private readonly wallets;
    private readonly txs;
    private readonly explorer;
    constructor(wallets: Repository<Wallet>, txs: Repository<Transaction>, explorer: ExplorerService);
    walletTransfers(network: string, address: string, opts: WalletTxOpts): Promise<{
        transfers: TransferItem[];
        diag: string | null;
        status?: SourceStatus;
    }>;
    private persist;
    private markLoaded;
}
