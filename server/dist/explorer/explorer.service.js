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
var ExplorerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExplorerService = void 0;
const common_1 = require("@nestjs/common");
const evm_provider_1 = require("./providers/evm.provider");
const tron_provider_1 = require("./providers/tron.provider");
const solana_provider_1 = require("./providers/solana.provider");
const orbiter_provider_1 = require("./providers/orbiter.provider");
const debridge_provider_1 = require("./providers/debridge.provider");
const price_provider_1 = require("./providers/price.provider");
const bridge_registry_service_1 = require("./bridge-registry.service");
const bridge_hub_service_1 = require("./bridges/bridge-hub.service");
const provider_health_service_1 = require("./provider-health.service");
const NATIVE_ASSETS = new Set(['ETH', 'BNB', 'POL', 'TRX', 'SOL']);
const MAX_TRANSFERS = 2000;
const MAX_LABELS = 20;
const TRACE_SUPPORTED = new Set(['ETH', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'TRON', 'SOLANA']);
const walletKey = (net, addr) => /^0x[0-9a-fA-F]{40}$/.test(addr) ? `EVM:${addr.toLowerCase()}` : `${net}:${addr}`;
let ExplorerService = ExplorerService_1 = class ExplorerService {
    constructor(evm, tron, solana, orbiter, debridge, price, bridgeRegistry, bridges, health) {
        this.evm = evm;
        this.tron = tron;
        this.solana = solana;
        this.orbiter = orbiter;
        this.debridge = debridge;
        this.price = price;
        this.bridgeRegistry = bridgeRegistry;
        this.bridges = bridges;
        this.health = health;
        this.logger = new common_1.Logger(ExplorerService_1.name);
    }
    async bridgeResolve(hash, chainId, tsMs, fast = false, prefer) {
        const ctx = { chainId, tsMs, fast };
        try {
            return prefer ? await this.bridges.resolve(prefer, hash, ctx) : await this.bridges.resolveAny(hash, ctx);
        }
        catch (e) {
            this.logger.error(`bridgeResolve ${hash}: ${e?.message}`);
            return { hop: null, outOfRange: false };
        }
    }
    orbiterResolve(hash, chainId, tsMs, fast = false, prefer) {
        return this.bridgeResolve(hash, chainId, tsMs, fast, prefer);
    }
    async orbiterFeed(opts) {
        try {
            return await this.orbiter.feed(opts);
        }
        catch (e) {
            return { hops: [], diag: String(e?.message || e) };
        }
    }
    async debridgeFeed(opts) {
        try {
            return await this.debridge.feed(opts);
        }
        catch (e) {
            return { hops: [], diag: String(e?.message || e) };
        }
    }
    async fetchTx(network, hash) {
        try {
            if (network === 'TRON')
                return await this.tron.fetchTx(hash);
            if (network === 'SOLANA')
                return await this.solana.fetchTx(hash);
            return await this.evm.fetchTx(network, hash);
        }
        catch (e) {
            this.logger.error(`fetchTx ${network} ${hash}: ${e?.message}`);
            return null;
        }
    }
    async fetchAddressLabel(network, address) {
        const known = await this.bridgeRegistry.forAddress(address);
        if (known)
            return { label: known.name, bridge: known.bridge };
        try {
            if (network === 'TRON')
                return await this.tron.fetchAddressLabel(address);
            if (network === 'SOLANA')
                return await this.solana.fetchAddressLabel(address);
            return await this.evm.fetchAddressLabel(network, address);
        }
        catch {
            return { label: null };
        }
    }
    async fetchBalance(network, address) {
        try {
            const [native, tokens] = await Promise.all([
                network === 'TRON' ? this.tron.fetchBalance(address)
                    : network === 'SOLANA' ? this.solana.fetchBalance(address)
                        : this.evm.fetchBalance(network, address),
                network === 'TRON' ? this.tron.fetchTokenBalances(address)
                    : network === 'SOLANA' ? this.solana.fetchTokenBalances(address)
                        : this.evm.fetchTokenBalances(network, address),
            ]);
            const raw = [];
            if (native.amount != null)
                raw.push({ asset: native.asset, amount: native.amount });
            raw.push(...tokens);
            const prices = await this.price.pricesFor([...new Set(raw.map((h) => h.asset))]);
            let totalUsd = null;
            const holdings = raw.map((h) => {
                const p = prices.get(h.asset.toUpperCase());
                const usdValue = p != null ? h.amount * p : null;
                if (usdValue != null)
                    totalUsd = (totalUsd ?? 0) + usdValue;
                return { asset: h.asset, amount: h.amount, usdValue };
            }).sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
            return { holdings, totalUsd, diag: native.diag };
        }
        catch (e) {
            return { holdings: [], totalUsd: null, diag: String(e?.message || e) };
        }
    }
    async fetchWalletTransfers(network, address, opts) {
        const o = {
            native: opts.native ?? true,
            token: opts.token ?? true,
            limit: Math.min(Math.max(Number(opts.limit) || 50, 1), MAX_TRANSFERS),
        };
        try {
            const started = Date.now();
            const res = network === 'TRON'
                ? await this.tron.fetchWalletTransfers(address, o)
                : network === 'SOLANA'
                    ? await this.solana.fetchWalletTransfers(address, o)
                    : await this.evm.fetchWalletTransfers(network, address, o);
            const status = res.status ?? (res.transfers.length ? 'ok' : res.diag ? 'down' : 'empty');
            this.health.record(res.source ?? network, status, { latencyMs: Date.now() - started, note: res.diag ?? undefined });
            const transfers = res.transfers
                .filter((t) => t.hash && (t.from || t.to))
                .filter((t) => { if (NATIVE_ASSETS.has(t.asset || ''))
                return true; return t.amount != null && !isNaN(t.amount) && t.amount >= 1; })
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                .slice(0, o.limit);
            await this.enrichUsd(transfers);
            if (opts.labels !== false)
                await this.enrichLabels(network, address, transfers);
            return { transfers, diag: transfers.length ? null : res.diag, status };
        }
        catch (e) {
            this.health.record(network, 'down', { note: String(e?.message || e) });
            return { transfers: [], diag: String(e?.message || e), status: 'down' };
        }
    }
    async enrichUsd(transfers) {
        const need = transfers.filter((t) => t.usdValue == null && t.amount != null && t.asset);
        if (!need.length)
            return;
        const prices = await this.price.pricesFor([...new Set(need.map((t) => t.asset))]);
        for (const t of need) {
            const p = prices.get(t.asset.toUpperCase());
            if (p != null)
                t.usdValue = t.amount * p;
        }
    }
    async traceFlow(opts) {
        const direction = opts.direction === 'in' ? 'in' : 'out';
        const maxHops = Math.min(Math.max(opts.maxHops ?? 3, 1), 5);
        const minUsd = Math.max(opts.minUsd ?? 50, 0);
        const perNode = Math.min(Math.max(opts.perNode ?? 25, 1), 50);
        const MAX_NODES = 120, MAX_EDGES = 800;
        let labelBudget = 80, bridgeBudget = 15;
        const labelCache = new Map();
        const getLabel = async (net, addr) => {
            const k = addr.toLowerCase();
            if (labelCache.has(k))
                return labelCache.get(k);
            if (labelBudget-- <= 0)
                return null;
            let label = null;
            try {
                label = (await this.fetchAddressLabel(net, addr)).label;
            }
            catch { }
            labelCache.set(k, label);
            return label;
        };
        const transfers = [];
        const hops = [];
        const terminals = new Set();
        const seen = new Set([walletKey(opts.network, opts.address)]);
        let nodeCount = 1;
        let frontier = [{ net: opts.network, addr: opts.address }];
        for (let depth = 0; depth < maxHops && frontier.length && nodeCount < MAX_NODES && transfers.length < MAX_EDGES; depth++) {
            const next = [];
            for (const node of frontier) {
                let res;
                try {
                    res = await this.fetchWalletTransfers(node.net, node.addr, { native: true, token: true, limit: perNode, labels: false });
                }
                catch {
                    continue;
                }
                const me = node.addr.toLowerCase();
                const mine = res.transfers
                    .filter((t) => { const a = direction === 'out' ? t.from : t.to; return a && a.toLowerCase() === me; })
                    .filter((t) => (t.usdValue ?? 0) >= minUsd)
                    .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
                const enqueueTarget = (hop) => {
                    const tw = hop.targetWallet;
                    if (tw && TRACE_SUPPORTED.has(hop.targetNet)) {
                        const k = walletKey(hop.targetNet, tw);
                        if (!seen.has(k) && nodeCount < MAX_NODES) {
                            seen.add(k);
                            nodeCount++;
                            next.push({ net: hop.targetNet, addr: tw });
                        }
                    }
                };
                let bridgeChecks = 0;
                for (const t of mine) {
                    if (transfers.length >= MAX_EDGES)
                        break;
                    const cp = direction === 'out' ? t.to : t.from;
                    if (!cp)
                        continue;
                    const label = await getLabel(node.net, cp);
                    if (label) {
                        if (direction === 'out')
                            t.toLabel = label;
                        else
                            t.fromLabel = label;
                    }
                    transfers.push(t);
                    const knownBridge = (await this.bridgeRegistry.forAddress(cp))?.bridge;
                    if (knownBridge && this.bridges.has(knownBridge)) {
                        if (bridgeBudget > 0) {
                            bridgeBudget--;
                            const { hop } = await this.bridgeResolve(t.hash, undefined, t.timestamp, true, knownBridge);
                            if (hop) {
                                hops.push(hop);
                                enqueueTarget(hop);
                            }
                        }
                        continue;
                    }
                    if (label) {
                        terminals.add(cp);
                        continue;
                    }
                    if (bridgeBudget > 0 && bridgeChecks < 2) {
                        bridgeChecks++;
                        bridgeBudget--;
                        const { hop } = await this.bridgeResolve(t.hash, undefined, t.timestamp, true);
                        if (hop) {
                            hops.push(hop);
                            enqueueTarget(hop);
                            continue;
                        }
                    }
                    const k = walletKey(node.net, cp);
                    if (seen.has(k))
                        continue;
                    seen.add(k);
                    if (nodeCount < MAX_NODES) {
                        nodeCount++;
                        next.push({ net: node.net, addr: cp });
                    }
                }
            }
            frontier = next;
        }
        return {
            transfers, hops, terminals: [...terminals],
            stats: { nodes: nodeCount, edges: transfers.length, bridges: hops.length, terminals: terminals.size, hops: maxHops },
            diag: transfers.length ? null : 'Поток не прослежен — нет переводов выше порога (попробуйте снизить мин. $).',
        };
    }
    async enrichLabels(network, wallet, transfers) {
        const self = wallet.toLowerCase();
        const counterparties = new Set();
        for (const t of transfers) {
            for (const a of [t.from, t.to]) {
                if (a && a.toLowerCase() !== self)
                    counterparties.add(a);
            }
            if (counterparties.size >= MAX_LABELS)
                break;
        }
        if (!counterparties.size)
            return;
        const labels = new Map();
        await Promise.all([...counterparties].slice(0, MAX_LABELS).map(async (addr) => {
            try {
                labels.set(addr, (await this.fetchAddressLabel(network, addr)).label);
            }
            catch {
                labels.set(addr, null);
            }
        }));
        for (const t of transfers) {
            if (t.from && labels.get(t.from))
                t.fromLabel = labels.get(t.from);
            if (t.to && labels.get(t.to))
                t.toLabel = labels.get(t.to);
        }
    }
};
exports.ExplorerService = ExplorerService;
exports.ExplorerService = ExplorerService = ExplorerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [evm_provider_1.EvmProvider,
        tron_provider_1.TronProvider,
        solana_provider_1.SolanaProvider,
        orbiter_provider_1.OrbiterProvider,
        debridge_provider_1.DebridgeProvider,
        price_provider_1.PriceProvider,
        bridge_registry_service_1.BridgeRegistryService,
        bridge_hub_service_1.BridgeHubService,
        provider_health_service_1.ProviderHealthService])
], ExplorerService);
//# sourceMappingURL=explorer.service.js.map