"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var PriceProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriceProvider = void 0;
const common_1 = require("@nestjs/common");
const CG = 'https://api.coingecko.com/api/v3/simple/price';
const TTL_MS = 5 * 60_000;
const STABLES = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDE', 'FDUSD', 'BSC-USD', 'USDD', 'PYUSD']);
const CG_IDS = {
    ETH: 'ethereum', WETH: 'ethereum',
    BNB: 'binancecoin', WBNB: 'binancecoin',
    POL: 'polygon-ecosystem-token', MATIC: 'matic-network', WMATIC: 'matic-network',
    TRX: 'tron', SOL: 'solana', WSOL: 'solana',
    BTC: 'bitcoin', WBTC: 'wrapped-bitcoin',
    ARB: 'arbitrum', OP: 'optimism', LINK: 'chainlink', UNI: 'uniswap',
};
let PriceProvider = PriceProvider_1 = class PriceProvider {
    constructor() {
        this.logger = new common_1.Logger(PriceProvider_1.name);
        this.cache = new Map();
    }
    async pricesFor(symbols) {
        const out = new Map();
        const wantIds = new Map();
        for (const raw of symbols) {
            const sym = (raw || '').toUpperCase();
            if (!sym || out.has(sym))
                continue;
            if (STABLES.has(sym)) {
                out.set(sym, 1);
                continue;
            }
            const cached = this.cache.get(sym);
            if (cached && Date.now() - cached.at < TTL_MS) {
                out.set(sym, cached.price);
                continue;
            }
            const id = CG_IDS[sym];
            if (id)
                wantIds.set(id, sym);
        }
        if (wantIds.size) {
            try {
                const ids = [...wantIds.keys()].join(',');
                const r = await fetch(`${CG}?ids=${ids}&vs_currencies=usd`);
                if (r.ok) {
                    const j = await r.json();
                    for (const [id, sym] of wantIds) {
                        const p = j[id]?.usd;
                        if (typeof p === 'number') {
                            out.set(sym, p);
                            this.cache.set(sym, { price: p, at: Date.now() });
                        }
                    }
                }
                else {
                    this.logger.warn(`CoinGecko HTTP ${r.status}`);
                }
            }
            catch (e) {
                this.logger.warn(`CoinGecko: ${e?.message}`);
            }
        }
        return out;
    }
};
exports.PriceProvider = PriceProvider;
exports.PriceProvider = PriceProvider = PriceProvider_1 = __decorate([
    (0, common_1.Injectable)()
], PriceProvider);
//# sourceMappingURL=price.provider.js.map