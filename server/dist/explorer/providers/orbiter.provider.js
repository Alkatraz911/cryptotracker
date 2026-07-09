"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OrbiterProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrbiterProvider = exports.ORBITER_CHAINS = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ORBITER_BASE = 'https://openapi.orbiter.finance/partner-data-openness/transcations/list';
const PAGE_ROWS = 10;
exports.ORBITER_CHAINS = {
    '1': { name: 'Ethereum', net: 'ETH', rpc: 'https://eth.llamarpc.com', tx: (h) => `https://etherscan.io/tx/${h}` },
    '42161': { name: 'Arbitrum', net: 'ARBITRUM', rpc: 'https://arb1.arbitrum.io/rpc', tx: (h) => `https://arbiscan.io/tx/${h}` },
    '8453': { name: 'Base', net: 'BASE', rpc: 'https://mainnet.base.org', tx: (h) => `https://basescan.org/tx/${h}` },
    '56': { name: 'BSC', net: 'BSC', rpc: 'https://bsc-dataseed.binance.org', tx: (h) => `https://bscscan.com/tx/${h}` },
    '137': { name: 'Polygon', net: 'POLYGON', rpc: 'https://polygon-rpc.com', tx: (h) => `https://polygonscan.com/tx/${h}` },
    '10': { name: 'Optimism', net: 'UNKNOWN', rpc: 'https://mainnet.optimism.io', tx: (h) => `https://optimistic.etherscan.io/tx/${h}` },
    '59144': { name: 'Linea', net: 'UNKNOWN', rpc: 'https://rpc.linea.build', tx: (h) => `https://lineascan.build/tx/${h}` },
    '324': { name: 'zkSync Era', net: 'UNKNOWN', rpc: 'https://mainnet.era.zksync.io', tx: (h) => `https://explorer.zksync.io/tx/${h}` },
    '534352': { name: 'Scroll', net: 'UNKNOWN', rpc: 'https://rpc.scroll.io', tx: (h) => `https://scrollscan.com/tx/${h}` },
    '5000': { name: 'Mantle', net: 'UNKNOWN', rpc: 'https://rpc.mantle.xyz', tx: (h) => `https://explorer.mantle.xyz/tx/${h}` },
    '728126428': { name: 'Tron', net: 'TRON', rpc: null, tx: (h) => `https://tronscan.org/#/transaction/${h}` },
    '501': { name: 'Solana', net: 'SOLANA', rpc: null, tx: (h) => `https://solscan.io/tx/${h}` },
};
let OrbiterProvider = OrbiterProvider_1 = class OrbiterProvider {
    constructor(cfg) {
        this.cfg = cfg;
        this.logger = new common_1.Logger(OrbiterProvider_1.name);
    }
    indexerUrl() {
        return (this.cfg.get('ORBITER_INDEXER_URL', '') || '').replace(/\/+$/, '');
    }
    chainName(chainId) { return exports.ORBITER_CHAINS[chainId]?.name ?? `chain ${chainId}`; }
    async fetchIndexer(path) {
        const base = this.indexerUrl();
        if (!base)
            return null;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 8000);
        try {
            const r = await fetch(`${base}${path}`, { signal: ac.signal });
            if (!r.ok)
                return null;
            return await r.json();
        }
        catch (e) {
            this.logger.warn(`[Indexer] ${path} failed: ${e?.message}`);
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    indexerBridgeToHop(b) {
        const s = exports.ORBITER_CHAINS[b.sourceChain];
        const t = exports.ORBITER_CHAINS[b.targetChain];
        return {
            sourceId: b.sourceId, targetId: b.targetId ?? '',
            sourceChain: b.sourceChain, targetChain: b.targetChain,
            sourceChainName: s?.name ?? `chain ${b.sourceChain}`,
            targetChainName: t?.name ?? `chain ${b.targetChain}`,
            sourceNet: s?.net ?? 'UNKNOWN', targetNet: t?.net ?? 'UNKNOWN',
            sourceTxUrl: s ? s.tx(b.sourceId) : '',
            targetTxUrl: t && b.targetId ? t.tx(b.targetId) : '',
            amount: Number(b.amount) || 0, symbol: b.symbol ?? '',
            usd: Number(b.usd) || 0, sourceTime: Date.parse(b.sourceTime),
            sourceAddress: b.sender ?? undefined, targetWallet: b.targetAddress ?? undefined,
        };
    }
    toHop(r) {
        const s = exports.ORBITER_CHAINS[r.sourceChain];
        const t = exports.ORBITER_CHAINS[r.targetChain];
        return {
            sourceId: r.sourceId, targetId: r.targetId,
            sourceChain: r.sourceChain, targetChain: r.targetChain,
            sourceChainName: s?.name ?? `chain ${r.sourceChain}`,
            targetChainName: t?.name ?? `chain ${r.targetChain}`,
            sourceNet: s?.net ?? 'UNKNOWN', targetNet: t?.net ?? 'UNKNOWN',
            sourceTxUrl: s ? s.tx(r.sourceId) : '', targetTxUrl: t ? t.tx(r.targetId) : '',
            amount: Number(r.sourceAmount) || 0, symbol: r.sourceSymbol,
            usd: Number(r.sourceAmountUSD) || 0, sourceTime: Date.parse(r.sourceTime),
        };
    }
    lookupToHop(r) {
        const s = exports.ORBITER_CHAINS[r.chainId];
        const t = exports.ORBITER_CHAINS[r.targetChain];
        return {
            sourceId: r.hash, targetId: r.targetId,
            sourceChain: r.chainId, targetChain: r.targetChain,
            sourceChainName: s?.name ?? `chain ${r.chainId}`,
            targetChainName: t?.name ?? `chain ${r.targetChain}`,
            sourceNet: s?.net ?? 'UNKNOWN', targetNet: t?.net ?? 'UNKNOWN',
            sourceTxUrl: s ? s.tx(r.hash) : '', targetTxUrl: t ? t.tx(r.targetId) : '',
            amount: Number(r.amount) || 0, symbol: r.symbol,
            usd: 0, sourceTime: Date.parse(r.timestamp),
            sourceAddress: r.sender, targetWallet: r.targetAddress,
        };
    }
    async lookupTx(hash) {
        for (const url of [
            `https://api.orbiter.finance/sdk/transaction/status/${hash}`,
            `https://api.orbiter.finance/transaction/${hash}`,
        ]) {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 8000);
            try {
                const r = await fetch(url, { signal: ac.signal });
                if (r.ok) {
                    const j = await r.json();
                    if (j.result?.targetId)
                        return j.result;
                }
            }
            catch { }
            finally {
                clearTimeout(timer);
            }
        }
        return null;
    }
    async fetchPage(params) {
        const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 14000);
        try {
            const r = await fetch(`${ORBITER_BASE}?${qs}`, { signal: ac.signal });
            if (!r.ok) {
                this.logger.warn(`[Orbiter] HTTP ${r.status}`);
                return [];
            }
            const j = await r.json();
            if (j.errno !== 0) {
                this.logger.warn(`[Orbiter] errno ${j.errno}`);
                return [];
            }
            return j.data?.rows ?? [];
        }
        catch {
            return [];
        }
        finally {
            clearTimeout(timer);
        }
    }
    async rpc(rpc, method, params) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 10000);
        try {
            const r = await fetch(rpc, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ac.signal,
            });
            const j = await r.json();
            return j.result ?? null;
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async blockTime(chainId, hash) {
        const rpc = exports.ORBITER_CHAINS[chainId]?.rpc;
        if (!rpc)
            return null;
        const tx = await this.rpc(rpc, 'eth_getTransactionByHash', [hash]);
        if (!tx?.blockNumber)
            return null;
        const blk = await this.rpc(rpc, 'eth_getBlockByNumber', [tx.blockNumber, false]);
        if (!blk?.timestamp)
            return null;
        return parseInt(blk.timestamp, 16) * 1000;
    }
    static newest(r) { return r.length ? Date.parse(r[0].sourceTime) : NaN; }
    static oldest(r) { return r.length ? Date.parse(r[r.length - 1].sourceTime) : NaN; }
    async locatePage(get, targetMs) {
        const { newest, oldest } = OrbiterProvider_1;
        const first = await get(1);
        if (!first.length)
            return { center: 1, outOfRange: false };
        if (targetMs >= oldest(first))
            return { center: 1, outOfRange: false };
        let loPage = 1, loT = newest(first);
        let hiPage = 0, hiT = 0, bracketed = false;
        for (let p = 1000;; p = Math.min(OrbiterProvider_1.MAX_PAGE, p * 4)) {
            const rows = await get(p);
            if (rows.length && newest(rows) <= targetMs) {
                hiPage = p;
                hiT = newest(rows);
                bracketed = true;
                break;
            }
            if (rows.length) {
                loPage = p;
                loT = newest(rows);
            }
            if (p >= OrbiterProvider_1.MAX_PAGE)
                break;
        }
        if (!bracketed)
            return { center: OrbiterProvider_1.MAX_PAGE, outOfRange: true };
        let center = hiPage;
        for (let i = 0; i < 10 && hiPage - loPage > 2; i++) {
            const span = loT - hiT || 1;
            let mid = Math.round(loPage + ((loT - targetMs) / span) * (hiPage - loPage));
            mid = Math.max(loPage + 1, Math.min(hiPage - 1, mid));
            const rows = await get(mid);
            if (!rows.length) {
                hiPage = mid;
                continue;
            }
            const nt = newest(rows), ot = oldest(rows);
            if (ot <= targetMs && targetMs <= nt)
                return { center: mid, outOfRange: false };
            if (nt < targetMs) {
                hiPage = mid;
                hiT = nt;
                center = mid;
            }
            else {
                loPage = mid;
                loT = ot;
                center = mid;
            }
        }
        return { center, outOfRange: false };
    }
    pageGetter(params, budget = OrbiterProvider_1.FETCH_BUDGET) {
        const cache = new Map();
        const state = { budget };
        const get = async (p) => {
            const pg = Math.max(1, Math.min(OrbiterProvider_1.MAX_PAGE, Math.round(p)));
            if (cache.has(pg))
                return cache.get(pg);
            if (state.budget-- <= 0)
                return [];
            let rows = await this.fetchPage({ page: pg, ...params });
            if (!rows.length && state.budget-- > 0)
                rows = await this.fetchPage({ page: pg, ...params });
            cache.set(pg, rows);
            return rows;
        };
        return { get, state };
    }
    async searchFeed(params, matchKey, hash, targetMs) {
        const { get, state } = this.pageGetter(params);
        const want = hash.toLowerCase();
        const find = (r) => r.find((x) => x[matchKey]?.toLowerCase() === want) ?? null;
        const { center, outOfRange } = await this.locatePage(get, targetMs);
        if (outOfRange)
            return { row: null, outOfRange: true };
        for (let d = 0; d <= 6 && state.budget > 0; d++) {
            for (const p of d === 0 ? [center] : [center - d, center + d]) {
                if (p < 1)
                    continue;
                const hit = find(await get(p));
                if (hit)
                    return { row: hit, outOfRange: false };
            }
        }
        return { row: null, outOfRange: false };
    }
    async resolve(hash, chainId, tsMs, fast = false) {
        const idx = await this.fetchIndexer(`/bridges/tx/${hash}`);
        if (idx?.bridge) {
            this.logger.log(`[Orbiter] indexer hit → ${idx.bridge.targetChain}`);
            return { hop: this.indexerBridgeToHop(idx.bridge), outOfRange: false };
        }
        const direct = await this.lookupTx(hash);
        if (direct) {
            this.logger.log(`[Orbiter] lookup match → ${direct.targetChain}`);
            return { hop: this.lookupToHop(direct), outOfRange: false };
        }
        if (fast)
            return { hop: null, outOfRange: false };
        if (!chainId) {
            this.logger.log(`[Orbiter] lookup miss, no chainId for feed fallback (${hash.slice(0, 12)}…)`);
            return { hop: null, outOfRange: false };
        }
        const targetMs = tsMs && tsMs > 0 ? tsMs : (await this.blockTime(chainId, hash)) ?? Date.now();
        this.logger.log(`[Orbiter] feed fallback ${hash.slice(0, 12)}… chain=${chainId} t=${new Date(targetMs).toISOString()}`);
        const others = Object.keys(exports.ORBITER_CHAINS).filter((c) => c !== chainId);
        const searches = [
            this.searchFeed({ sourceChain: chainId }, 'sourceId', hash, targetMs),
            this.searchFeed({ targetChain: chainId }, 'targetId', hash, targetMs),
            ...others.flatMap((o) => [
                this.searchFeed({ sourceChain: chainId, targetChain: o }, 'sourceId', hash, targetMs),
                this.searchFeed({ sourceChain: o, targetChain: chainId }, 'targetId', hash, targetMs),
            ]),
        ];
        const results = await Promise.all(searches);
        const hit = results.find((r) => r.row);
        if (hit?.row) {
            this.logger.log(`[Orbiter] feed match → ${hit.row.targetChain}`);
            return { hop: this.toHop(hit.row), outOfRange: false };
        }
        const outOfRange = results.some((r) => r.outOfRange);
        this.logger.log(`[Orbiter] no match for ${hash.slice(0, 12)}…${outOfRange ? ' (out of reachable range)' : ''}`);
        return { hop: null, outOfRange };
    }
    async feed(opts) {
        const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
        const minUsd = opts.minUsd ?? 0;
        const sinceMs = opts.sinceMs ?? 0;
        const untilMs = opts.untilMs ?? 0;
        if (this.indexerUrl()) {
            const qp = new URLSearchParams({ source: opts.sourceChain, limit: String(limit) });
            if (opts.targetChain)
                qp.set('target', opts.targetChain);
            if (minUsd)
                qp.set('minUsd', String(minUsd));
            if (sinceMs)
                qp.set('from', new Date(sinceMs).toISOString());
            if (untilMs)
                qp.set('to', new Date(untilMs).toISOString());
            const idx = await this.fetchIndexer(`/bridges?${qp.toString()}`);
            if (idx?.bridges?.length) {
                this.logger.log(`[Orbiter] indexer feed: ${idx.bridges.length} hops`);
                return { hops: idx.bridges.map((b) => this.indexerBridgeToHop(b)), diag: null };
            }
        }
        const params = { sourceChain: opts.sourceChain };
        if (opts.targetChain)
            params.targetChain = opts.targetChain;
        const { get, state } = this.pageGetter(params, 1200);
        let startPage = 1;
        let outOfRange = false;
        if (untilMs) {
            const loc = await this.locatePage(get, untilMs);
            startPage = loc.center;
            outOfRange = loc.outOfRange;
        }
        const out = [];
        const BATCH = 10;
        let page = startPage;
        let pastWindow = false;
        while (!pastWindow && state.budget > 0) {
            const batchPages = Array.from({ length: BATCH }, (_, i) => page + i);
            page += BATCH;
            const batch = await Promise.all(batchPages.map((p) => get(p)));
            for (const rows of batch) {
                if (!rows.length) {
                    pastWindow = true;
                    break;
                }
                for (const r of rows) {
                    const t = Date.parse(r.sourceTime);
                    if (untilMs && t > untilMs)
                        continue;
                    if (sinceMs && t < sinceMs) {
                        pastWindow = true;
                        break;
                    }
                    if (opts.targetChain && r.targetChain !== opts.targetChain)
                        continue;
                    if ((Number(r.sourceAmountUSD) || 0) < minUsd)
                        continue;
                    out.push(this.toHop(r));
                    if (out.length >= limit) {
                        pastWindow = true;
                        break;
                    }
                }
                if (pastWindow)
                    break;
                if (rows.length < PAGE_ROWS) {
                    pastWindow = true;
                    break;
                }
            }
        }
        const diag = out.length ? null
            : outOfRange ? 'Orbiter: период старше доступной глубины фида'
                : 'Orbiter: подходящих переводов не найдено (проверьте сети/фильтры/период)';
        return { hops: out, diag };
    }
};
exports.OrbiterProvider = OrbiterProvider;
OrbiterProvider.MAX_PAGE = 60000;
OrbiterProvider.FETCH_BUDGET = 70;
exports.OrbiterProvider = OrbiterProvider = OrbiterProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], OrbiterProvider);
//# sourceMappingURL=orbiter.provider.js.map