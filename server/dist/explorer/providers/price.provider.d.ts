export declare class PriceProvider {
    private readonly logger;
    private cache;
    pricesFor(symbols: string[]): Promise<Map<string, number>>;
}
