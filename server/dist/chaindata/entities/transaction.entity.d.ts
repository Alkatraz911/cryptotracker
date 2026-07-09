export declare class Transaction {
    dedupKey: string;
    network: string;
    hash: string;
    blockTs: number | null;
    fromAddr: string | null;
    toAddr: string | null;
    asset: string | null;
    amount: number | null;
    usd: number | null;
    fromLabel: string | null;
    toLabel: string | null;
}
