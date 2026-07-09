"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const typeorm_1 = require("@nestjs/typeorm");
const chaindata_service_1 = require("./chaindata.service");
const explorer_service_1 = require("../explorer/explorer.service");
const wallet_entity_1 = require("./entities/wallet.entity");
const transaction_entity_1 = require("./entities/transaction.entity");
describe('ChainDataService', () => {
    let service;
    let qb;
    const walletsRepo = { findOneBy: jest.fn(), upsert: jest.fn() };
    const txsRepo = { createQueryBuilder: jest.fn(), upsert: jest.fn(), create: jest.fn((x) => x) };
    const explorer = { fetchWalletTransfers: jest.fn() };
    beforeEach(async () => {
        jest.clearAllMocks();
        qb = {
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            take: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue([]),
            getRawOne: jest.fn().mockResolvedValue({ cnt: '0', withTs: '0', oldest: null }),
        };
        txsRepo.createQueryBuilder.mockReturnValue(qb);
        const module = await testing_1.Test.createTestingModule({
            providers: [
                chaindata_service_1.ChainDataService,
                { provide: (0, typeorm_1.getRepositoryToken)(wallet_entity_1.Wallet), useValue: walletsRepo },
                { provide: (0, typeorm_1.getRepositoryToken)(transaction_entity_1.Transaction), useValue: txsRepo },
                { provide: explorer_service_1.ExplorerService, useValue: explorer },
            ],
        }).compile();
        service = module.get(chaindata_service_1.ChainDataService);
    });
    const opts = { native: true, token: true, limit: 50 };
    const ADDR = '0x' + 'Ab'.repeat(20);
    const ADDR_LC = ADDR.toLowerCase();
    const TO = '0x' + '12'.repeat(20);
    it('fetches from the explorer and persists when the wallet was never loaded', async () => {
        walletsRepo.findOneBy.mockResolvedValue(null);
        explorer.fetchWalletTransfers.mockResolvedValue({
            transfers: [{ network: 'ETH', hash: '0xh', from: ADDR, to: TO, amount: 5, asset: 'ETH', timestamp: 111, usdValue: 9 }],
            diag: null,
        });
        await service.walletTransfers('eth', ADDR, opts);
        expect(explorer.fetchWalletTransfers).toHaveBeenCalledWith('ETH', ADDR_LC, { native: true, token: true, limit: 50 });
        expect(txsRepo.upsert).toHaveBeenCalledTimes(1);
        const [rows] = txsRepo.upsert.mock.calls[0];
        expect(rows[0].fromAddr).toBe(ADDR_LC);
        expect(rows[0].dedupKey).toBe(`ETH|0xh|${ADDR_LC}|${TO}|ETH|5`);
        expect(walletsRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({ network: 'ETH', address: ADDR_LC }), expect.anything());
    });
    it('serves from the DB without hitting the explorer when already loaded', async () => {
        walletsRepo.findOneBy.mockResolvedValue({ network: 'ETH', address: ADDR_LC, txsLoadedAt: new Date() });
        qb.getMany.mockResolvedValue([
            { network: 'ETH', hash: '0xh', fromAddr: ADDR_LC, toAddr: TO, amount: 5, asset: 'ETH', blockTs: 111, usd: 9, fromLabel: null, toLabel: null },
        ]);
        const res = await service.walletTransfers('ETH', ADDR, opts);
        expect(explorer.fetchWalletTransfers).not.toHaveBeenCalled();
        expect(res.transfers).toHaveLength(1);
        expect(res.transfers[0]).toMatchObject({ from: ADDR_LC, timestamp: 111, usdValue: 9 });
    });
    it('re-fetches when force is set even if already loaded', async () => {
        walletsRepo.findOneBy.mockResolvedValue({ network: 'ETH', address: ADDR_LC, txsLoadedAt: new Date() });
        explorer.fetchWalletTransfers.mockResolvedValue({ transfers: [], diag: null });
        await service.walletTransfers('ETH', ADDR, { ...opts, force: true });
        expect(explorer.fetchWalletTransfers).toHaveBeenCalledTimes(1);
    });
    it('self-heals: re-fetches when marked loaded but nothing is stored and the attempt is stale', async () => {
        walletsRepo.findOneBy.mockResolvedValue({ network: 'ETH', address: ADDR_LC, txsLoadedAt: new Date(Date.now() - 20 * 60 * 1000) });
        qb.getRawOne.mockResolvedValue({ cnt: '0', oldest: null });
        explorer.fetchWalletTransfers.mockResolvedValue({ transfers: [], diag: 'rate limited' });
        await service.walletTransfers('ETH', ADDR, opts);
        expect(explorer.fetchWalletTransfers).toHaveBeenCalledTimes(1);
    });
    it('re-fetches when the requested period starts older than the stored history', async () => {
        walletsRepo.findOneBy.mockResolvedValue({ network: 'ETH', address: ADDR_LC, txsLoadedAt: new Date() });
        qb.getRawOne.mockResolvedValue({ cnt: '5', withTs: '5', oldest: '200' });
        explorer.fetchWalletTransfers.mockResolvedValue({ transfers: [], diag: null });
        await service.walletTransfers('ETH', ADDR, { ...opts, fromMs: 100 });
        expect(explorer.fetchWalletTransfers).toHaveBeenCalledTimes(1);
    });
    it('serves from the DB for a period already covered by the stored history', async () => {
        walletsRepo.findOneBy.mockResolvedValue({ network: 'ETH', address: ADDR_LC, txsLoadedAt: new Date() });
        qb.getRawOne.mockResolvedValue({ cnt: '5', withTs: '5', oldest: '200' });
        await service.walletTransfers('ETH', ADDR, { ...opts, fromMs: 300 });
        expect(explorer.fetchWalletTransfers).not.toHaveBeenCalled();
    });
    it('re-fetches to backfill when a period is requested but stored rows lack timestamps', async () => {
        walletsRepo.findOneBy.mockResolvedValue({ network: 'ETH', address: ADDR_LC, txsLoadedAt: new Date(Date.now() - 20 * 60 * 1000) });
        qb.getRawOne.mockResolvedValue({ cnt: '46', withTs: '16', oldest: '1000' });
        explorer.fetchWalletTransfers.mockResolvedValue({ transfers: [], diag: null });
        await service.walletTransfers('ETH', ADDR, { ...opts, fromMs: 5000 });
        expect(explorer.fetchWalletTransfers).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=chaindata.service.spec.js.map