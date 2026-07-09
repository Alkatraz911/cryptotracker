import { ChainDataService } from './chaindata.service';
export declare class ChainDataController {
    private readonly chaindata;
    constructor(chaindata: ChainDataService);
    getWallet(network: string, address: string, native: string, token: string, limit: string, force: string, from: string, to: string, asset: string): Promise<{
        transfers: import("../explorer/providers/evm.provider").TransferItem[];
        diag: string | null;
        status?: import("../explorer/provider-health.service").SourceStatus;
    }> | {
        transfers: never[];
        diag: null;
    };
}
