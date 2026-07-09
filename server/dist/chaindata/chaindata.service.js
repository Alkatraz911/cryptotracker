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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChainDataService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const explorer_service_1 = require("../explorer/explorer.service");
const wallet_entity_1 = require("./entities/wallet.entity");
const transaction_entity_1 = require("./entities/transaction.entity");
const isEvm = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
const normAddr = (a) => (isEvm(a) ? a.toLowerCase() : a);
let ChainDataService = class ChainDataService {
    constructor(wallets, txs, explorer) {
        this.wallets = wallets;
        this.txs = txs;
        this.explorer = explorer;
    }
    async walletTransfers(network, address, opts) {
        network = network.toUpperCase();
        const addr = normAddr(address);
        const wallet = await this.wallets.findOneBy({ network, address: addr });
        const hasRange = opts.fromMs != null || opts.toMs != null;
        const agg = await this.txs
            .createQueryBuilder('t')
            .select('COUNT(1)', 'cnt')
            .addSelect('COUNT(t.block_ts)', 'withTs')
            .addSelect('MIN(t.block_ts)', 'oldest')
            .where('t.network = :network', { network })
            .andWhere('(t.fromAddr = :addr OR t.toAddr = :addr)', { addr })
            .getRawOne();
        const stored = Number(agg?.cnt ?? 0);
        const withTs = Number(agg?.withTs ?? 0);
        const oldestMs = agg?.oldest != null ? Number(agg.oldest) : null;
        const loadedAt = wallet?.txsLoadedAt ? new Date(wallet.txsLoadedAt).getTime() : 0;
        const stale = Date.now() - loadedAt > 10 * 60 * 1000;
        const rangeUncovered = hasRange && (oldestMs == null || (opts.fromMs != null && opts.fromMs < oldestMs));
        const missingTs = hasRange && stored > withTs && stale;
        const needFetch = opts.force || !wallet?.txsLoadedAt || (stored === 0 && stale) || rangeUncovered || missingTs;
        let fetchDiag = null;
        let fetchStatus;
        if (needFetch) {
            const res = await this.explorer.fetchWalletTransfers(network, addr, {
                native: opts.native, token: opts.token, limit: opts.limit,
            });
            fetchDiag = res.diag;
            fetchStatus = res.status;
            await this.persist(network, res.transfers);
            await this.markLoaded(network, addr);
        }
        const qb = this.txs
            .createQueryBuilder('t')
            .where('t.network = :network', { network })
            .andWhere('(t.fromAddr = :addr OR t.toAddr = :addr)', { addr });
        if (opts.fromMs != null)
            qb.andWhere('t.blockTs >= :fromMs', { fromMs: opts.fromMs });
        if (opts.toMs != null)
            qb.andWhere('t.blockTs <= :toMs', { toMs: opts.toMs });
        if (opts.asset)
            qb.andWhere('t.asset = :asset', { asset: opts.asset });
        const rows = await qb.orderBy('t.blockTs', 'DESC', 'NULLS LAST').take(opts.limit).getMany();
        const status = fetchStatus ?? (rows.length ? 'ok' : undefined);
        return { transfers: rows.map(toTransferItem), diag: rows.length ? null : fetchDiag, status };
    }
    async persist(network, transfers) {
        if (!transfers.length)
            return;
        const byKey = new Map();
        for (const t of transfers) {
            if (!t.hash || (!t.from && !t.to))
                continue;
            const fromAddr = t.from ? normAddr(t.from) : null;
            const toAddr = t.to ? normAddr(t.to) : null;
            const amount = t.amount ?? null;
            const dedupKey = [network, t.hash, fromAddr ?? '', toAddr ?? '', t.asset ?? '', amount ?? ''].join('|');
            byKey.set(dedupKey, this.txs.create({
                dedupKey, network, hash: t.hash,
                blockTs: t.timestamp ?? null,
                fromAddr, toAddr,
                asset: t.asset ?? null,
                amount,
                usd: t.usdValue ?? null,
                fromLabel: t.fromLabel ?? null,
                toLabel: t.toLabel ?? null,
            }));
        }
        const rows = [...byKey.values()];
        if (rows.length)
            await this.txs.upsert(rows, { conflictPaths: ['dedupKey'], skipUpdateIfNoValuesChanged: true });
    }
    async markLoaded(network, address) {
        await this.wallets.upsert({ network, address, txsLoadedAt: new Date() }, { conflictPaths: ['network', 'address'], skipUpdateIfNoValuesChanged: false });
    }
};
exports.ChainDataService = ChainDataService;
exports.ChainDataService = ChainDataService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(wallet_entity_1.Wallet)),
    __param(1, (0, typeorm_1.InjectRepository)(transaction_entity_1.Transaction)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        explorer_service_1.ExplorerService])
], ChainDataService);
function toTransferItem(t) {
    return {
        network: t.network,
        hash: t.hash,
        from: t.fromAddr,
        to: t.toAddr,
        amount: t.amount ?? undefined,
        asset: t.asset ?? undefined,
        usdValue: t.usd ?? undefined,
        timestamp: t.blockTs ?? undefined,
        fromLabel: t.fromLabel ?? undefined,
        toLabel: t.toLabel ?? undefined,
    };
}
//# sourceMappingURL=chaindata.service.js.map