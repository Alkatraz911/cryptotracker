"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DebridgeProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DebridgeProvider = exports.NET_TO_DEBRIDGE = exports.DEBRIDGE_CHAINS = void 0;
const common_1 = require("@nestjs/common");
const DLN_BASE = 'https://stats-api.dln.trade/api';
const ORDER_STATES = ['Fulfilled', 'SentUnlock', 'ClaimedUnlock'];
exports.DEBRIDGE_CHAINS = {
    '1': { name: 'Ethereum', net: 'ETH', tx: (h) => `https://etherscan.io/tx/${h}` },
    '56': { name: 'BSC', net: 'BSC', tx: (h) => `https://bscscan.com/tx/${h}` },
    '137': { name: 'Polygon', net: 'POLYGON', tx: (h) => `https://polygonscan.com/tx/${h}` },
    '42161': { name: 'Arbitrum', net: 'ARBITRUM', tx: (h) => `https://arbiscan.io/tx/${h}` },
    '8453': { name: 'Base', net: 'BASE', tx: (h) => `https://basescan.org/tx/${h}` },
    '10': { name: 'Optimism', net: 'UNKNOWN', tx: (h) => `https://optimistic.etherscan.io/tx/${h}` },
    '43114': { name: 'Avalanche', net: 'UNKNOWN', tx: (h) => `https://snowtrace.io/tx/${h}` },
    '59144': { name: 'Linea', net: 'UNKNOWN', tx: (h) => `https://lineascan.build/tx/${h}` },
    '100': { name: 'Gnosis', net: 'UNKNOWN', tx: (h) => `https://gnosisscan.io/tx/${h}` },
    '146': { name: 'Sonic', net: 'UNKNOWN', tx: (h) => `https://sonicscan.org/tx/${h}` },
    '7565164': { name: 'Solana', net: 'SOLANA', tx: (h) => `https://solscan.io/tx/${h}` },
};
exports.NET_TO_DEBRIDGE = {
    ETH: '1', BSC: '56', POLYGON: '137', ARBITRUM: '42161', BASE: '8453', SOLANA: '7565164',
};
const sv = (x) => (x == null ? null : typeof x === 'string' ? x : x.stringValue ?? null);
let DebridgeProvider = DebridgeProvider_1 = class DebridgeProvider {
    constructor() {
        this.logger = new common_1.Logger(DebridgeProvider_1.name);
    }
    chainName(id) { return exports.DEBRIDGE_CHAINS[id]?.name ?? `chain ${id}`; }
    async getJson(path) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 12000);
        try {
            const r = await fetch(`${DLN_BASE}${path}`, { signal: ac.signal });
            return r.ok ? (await r.json()) : null;
        }
        catch (e) {
            this.logger.warn(`GET ${path}: ${e?.message}`);
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async postJson(path, body) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 12000);
        try {
            const r = await fetch(`${DLN_BASE}${path}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body), signal: ac.signal,
            });
            return r.ok ? (await r.json()) : null;
        }
        catch (e) {
            this.logger.warn(`POST ${path}: ${e?.message}`);
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    amount(off) {
        const raw = sv(off?.amount);
        const dec = off?.decimals ?? 18;
        return raw ? Number(raw) / 10 ** dec : 0;
    }
    orderToHop(o) {
        const srcChain = sv(o.giveOfferWithMetadata?.chainId);
        const dstChain = sv(o.takeOfferWithMetadata?.chainId);
        if (!srcChain || !dstChain)
            return null;
        const s = exports.DEBRIDGE_CHAINS[srcChain];
        const t = exports.DEBRIDGE_CHAINS[dstChain];
        const srcTx = sv(o.createdSrcEventMetadata?.transactionHash) ?? sv(o.createEventTransactionHash) ?? '';
        const dstTx = sv(o.fulfilledDstEventMetadata?.transactionHash) ?? '';
        const ts = (o.createdSrcEventMetadata?.blockTimeStamp ?? o.creationTimestamp ?? 0) * 1000;
        return {
            sourceId: srcTx, targetId: dstTx,
            sourceChain: srcChain, targetChain: dstChain,
            sourceChainName: s?.name ?? `chain ${srcChain}`,
            targetChainName: t?.name ?? `chain ${dstChain}`,
            sourceNet: s?.net ?? 'UNKNOWN', targetNet: t?.net ?? 'UNKNOWN',
            sourceTxUrl: s && srcTx ? s.tx(srcTx) : '',
            targetTxUrl: t && dstTx ? t.tx(dstTx) : '',
            amount: this.amount(o.giveOfferWithMetadata),
            symbol: o.giveOfferWithMetadata?.symbol ?? '',
            usd: 0,
            sourceTime: ts,
            sourceAddress: sv(o.makerSrc) ?? undefined,
            targetWallet: sv(o.receiverDst) ?? undefined,
        };
    }
    async resolve(hash) {
        const ids = await this.getJson(`/Transaction/${hash}/orderIds`);
        const orderId = ids?.orderIds?.[0]?.stringValue;
        if (!orderId)
            return null;
        const order = await this.getJson(`/Orders/${orderId}`);
        if (!order)
            return null;
        const hop = this.orderToHop(order);
        if (hop)
            this.logger.log(`[deBridge] resolve ${hash.slice(0, 12)}… → ${hop.sourceChainName}→${hop.targetChainName}`);
        return hop;
    }
    async feed(opts) {
        const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
        const sinceMs = opts.sinceMs ?? 0;
        const body = { orderStates: ORDER_STATES, take: Math.min(limit, 100) };
        if (opts.sourceChain && exports.NET_TO_DEBRIDGE[opts.sourceChain])
            body.giveChainIds = [Number(exports.NET_TO_DEBRIDGE[opts.sourceChain])];
        if (opts.targetChain && exports.NET_TO_DEBRIDGE[opts.targetChain])
            body.takeChainIds = [Number(exports.NET_TO_DEBRIDGE[opts.targetChain])];
        const list = [];
        const MAX_PAGES = 20;
        for (let page = 0; page < MAX_PAGES && list.length < limit; page++) {
            const res = await this.postJson('/Orders/filteredList', { ...body, skip: page * 100 });
            const orders = res?.orders ?? [];
            if (!orders.length)
                break;
            let passed = false;
            for (const o of orders) {
                if (sinceMs && (o.creationTimestamp ?? 0) * 1000 < sinceMs) {
                    passed = true;
                    break;
                }
                list.push(o);
                if (list.length >= limit)
                    break;
            }
            if (passed || orders.length < 100)
                break;
        }
        if (!list.length)
            return { hops: [], diag: 'deBridge: ордеров не найдено (проверьте сети/период)' };
        const hops = [];
        const minUsd = opts.minUsd ?? 0;
        const BATCH = 8;
        for (let i = 0; i < list.length; i += BATCH) {
            const batch = list.slice(i, i + BATCH);
            const detailed = await Promise.all(batch.map(async (o) => {
                const id = sv(o.orderId);
                const full = id ? await this.getJson(`/Orders/${id}`) : null;
                return this.orderToHop(full ?? o);
            }));
            for (const h of detailed) {
                if (!h)
                    continue;
                if (minUsd && (h.usd || 0) < minUsd)
                    continue;
                hops.push(h);
            }
        }
        return { hops, diag: hops.length ? null : 'deBridge: подходящих ордеров не найдено' };
    }
};
exports.DebridgeProvider = DebridgeProvider;
exports.DebridgeProvider = DebridgeProvider = DebridgeProvider_1 = __decorate([
    (0, common_1.Injectable)()
], DebridgeProvider);
//# sourceMappingURL=debridge.provider.js.map