import { TokenRegistryService } from './token-registry.service';
import type { TokenContract } from './entities/token-contract.entity';
import type { TransferItem } from './providers/evm.provider';

describe('TokenRegistryService', () => {
  const contract = '0x' + 'a'.repeat(40);
  const admin = {
    network: 'BSC', contract, symbol: 'USDT', name: 'Manual decision', decimals: 18,
    status: 'trusted', source: 'admin', reason: 'Checked on chain', coingeckoId: null,
    seenCount: 1, firstSeen: new Date(), lastSeen: new Date(), updatedBy: 'admin@example.com', updatedAt: new Date(),
  } as TokenContract;
  const repo: any = {
    find: jest.fn().mockResolvedValue([admin]),
    findOneBy: jest.fn().mockResolvedValue(admin),
    increment: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    save: jest.fn(async (row) => row),
    create: jest.fn((row) => row),
  };
  const service = new TokenRegistryService(repo);

  it('annotates an existing contract and keeps old transfers without a contract visible', async () => {
    const transfers: TransferItem[] = [
      { network: 'BSC', hash: '1', from: null, to: null, asset: 'USDT', contract },
      { network: 'BSC', hash: '2', from: null, to: null, asset: 'USDT' },
    ];
    await service.annotate(transfers);
    expect(transfers[0].tokenStatus).toBe('trusted');
    expect(transfers[1].tokenStatus).toBe('unknown');
  });

  it('observation does not replace an admin decision', async () => {
    await service.observe([{ network: 'BSC', hash: '1', from: null, to: null, asset: 'USDT', contract, tokenName: 'Fake' }]);
    expect(repo.update).toHaveBeenCalledWith({ network: 'BSC', contract }, expect.not.objectContaining({ status: expect.anything() }));
    expect(repo.save).not.toHaveBeenCalled();
  });
});
