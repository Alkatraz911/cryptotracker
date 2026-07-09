import { Injectable, Logger } from '@nestjs/common';

// Lightweight USD price lookup via CoinGecko (free, no key). Used to put a $
// value on transfers whose provider didn't already supply one. Prices are
// CURRENT (approximate for old txs) and cached briefly to respect rate limits.
const CG = 'https://api.coingecko.com/api/v3/simple/price';
const TTL_MS = 5 * 60_000;

// Stablecoins → assume $1 (covers most token transfers, no network call needed).
const STABLES = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDE', 'FDUSD', 'BSC-USD', 'USDD', 'PYUSD']);

// Asset ticker → CoinGecko id (natives + a few majors). Extend as needed.
const CG_IDS: Record<string, string> = {
  ETH: 'ethereum', WETH: 'ethereum',
  BNB: 'binancecoin', WBNB: 'binancecoin',
  POL: 'polygon-ecosystem-token', MATIC: 'matic-network', WMATIC: 'matic-network',
  TRX: 'tron', SOL: 'solana', WSOL: 'solana',
  BTC: 'bitcoin', WBTC: 'wrapped-bitcoin',
  ARB: 'arbitrum', OP: 'optimism', LINK: 'chainlink', UNI: 'uniswap',
};

@Injectable()
export class PriceProvider {
  private readonly logger = new Logger(PriceProvider.name);
  private cache = new Map<string, { price: number; at: number }>();

  // Resolve USD prices for a set of asset tickers → Map<TICKER, price>.
  async pricesFor(symbols: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const wantIds = new Map<string, string>(); // cgId → ticker(upper)

    for (const raw of symbols) {
      const sym = (raw || '').toUpperCase();
      if (!sym || out.has(sym)) continue;
      if (STABLES.has(sym)) { out.set(sym, 1); continue; }
      const cached = this.cache.get(sym);
      if (cached && Date.now() - cached.at < TTL_MS) { out.set(sym, cached.price); continue; }
      const id = CG_IDS[sym];
      if (id) wantIds.set(id, sym);
    }

    if (wantIds.size) {
      try {
        const ids = [...wantIds.keys()].join(',');
        const r = await fetch(`${CG}?ids=${ids}&vs_currencies=usd`);
        if (r.ok) {
          const j = await r.json() as Record<string, { usd?: number }>;
          for (const [id, sym] of wantIds) {
            const p = j[id]?.usd;
            if (typeof p === 'number') { out.set(sym, p); this.cache.set(sym, { price: p, at: Date.now() }); }
          }
        } else { this.logger.warn(`CoinGecko HTTP ${r.status}`); }
      } catch (e) { this.logger.warn(`CoinGecko: ${(e as Error)?.message}`); }
    }
    return out;
  }
}
