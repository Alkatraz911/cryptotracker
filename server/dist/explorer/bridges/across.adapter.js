"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AcrossAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcrossAdapter = void 0;
const common_1 = require("@nestjs/common");
const orbiter_provider_1 = require("../providers/orbiter.provider");
const ACROSS_STATUS = 'https://app.across.to/api/deposit/status';
const ACROSS_DEPOSITS = 'https://app.across.to/api/deposits';
const ACROSS_CHAINS = {
    '34268394551451': { name: 'Solana', net: 'SOLANA', tx: (h) => `https://solscan.io/tx/${h}` },
};
const chainDef = (id) => orbiter_provider_1.ORBITER_CHAINS[id] ?? ACROSS_CHAINS[id];
const TOKENS = {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6 },
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { symbol: 'USDC', decimals: 6 },
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
    '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': { symbol: 'USDC', decimals: 6 },
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { symbol: 'USDT', decimals: 18 },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6 },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', decimals: 18 },
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { symbol: 'WETH', decimals: 18 },
    '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
};
const tokenInfo = (a) => (a ? TOKENS[a] ?? TOKENS[a.toLowerCase()] : undefined);
let AcrossAdapter = AcrossAdapter_1 = class AcrossAdapter {
    constructor() {
        this.id = 'across';
        this.name = 'Across';
        this.logger = new common_1.Logger(AcrossAdapter_1.name);
    }
    async resolve(hash, ctx) {
        const originChainId = ctx.chainId;
        if (!originChainId)
            return { hop: null, outOfRange: false };
        const status = await this.getJson(`${ACROSS_STATUS}?originChainId=${originChainId}&depositTxHash=${hash}`);
        if (!status ||
            status.depositTxHash?.toLowerCase() !== hash.toLowerCase() ||
            status.status !== 'filled' ||
            !status.fillTx ||
            status.destinationChainId == null) {
            return { hop: null, outOfRange: false };
        }
        const srcChain = String(originChainId);
        const dstChain = String(status.destinationChainId);
        let amount = 0, symbol = '', usd = 0;
        let sourceTime = ctx.tsMs ?? Date.now();
        let sourceAddress;
        let targetWallet;
        try {
            const from = await this.txSender(srcChain, hash);
            if (from) {
                const list = await this.getJson(`${ACROSS_DEPOSITS}?depositor=${from}&limit=100`);
                const d = Array.isArray(list) ? list.find((x) => x.depositTxHash?.toLowerCase() === hash.toLowerCase()) : undefined;
                if (d) {
                    sourceAddress = d.depositor ?? from;
                    targetWallet = d.recipient ?? undefined;
                    if (d.depositBlockTimestamp)
                        sourceTime = Date.parse(d.depositBlockTimestamp) || sourceTime;
                    const ti = tokenInfo(d.outputToken);
                    if (ti && d.outputAmount != null) {
                        amount = Number(d.outputAmount) / 10 ** ti.decimals;
                        symbol = ti.symbol;
                        usd = d.outputPriceUsd ? amount * Number(d.outputPriceUsd) : 0;
                    }
                }
                else {
                    sourceAddress = from;
                }
            }
        }
        catch (e) {
            this.logger.warn(`[Across] enrich failed: ${e?.message}`);
        }
        const s = chainDef(srcChain), t = chainDef(dstChain);
        const hop = {
            sourceId: hash, targetId: status.fillTx,
            sourceChain: srcChain, targetChain: dstChain,
            sourceChainName: s?.name ?? `chain ${srcChain}`,
            targetChainName: t?.name ?? `chain ${dstChain}`,
            sourceNet: s?.net ?? 'UNKNOWN', targetNet: t?.net ?? 'UNKNOWN',
            sourceTxUrl: s ? s.tx(hash) : '',
            targetTxUrl: t ? t.tx(status.fillTx) : '',
            amount, symbol, usd, sourceTime,
            sourceAddress, targetWallet,
        };
        this.logger.log(`[Across] match ${srcChain}→${dstChain}${symbol ? ` ${amount} ${symbol}` : ''}`);
        return { hop, outOfRange: false };
    }
    async getJson(url) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 10000);
        try {
            const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
            if (!r.ok)
                return null;
            return await r.json();
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async txSender(chainId, hash) {
        const rpc = orbiter_provider_1.ORBITER_CHAINS[chainId]?.rpc;
        if (!rpc)
            return null;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 8000);
        try {
            const r = await fetch(rpc, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [hash] }),
                signal: ac.signal,
            });
            const j = await r.json();
            return j.result?.from ?? null;
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
};
exports.AcrossAdapter = AcrossAdapter;
exports.AcrossAdapter = AcrossAdapter = AcrossAdapter_1 = __decorate([
    (0, common_1.Injectable)()
], AcrossAdapter);
//# sourceMappingURL=across.adapter.js.map