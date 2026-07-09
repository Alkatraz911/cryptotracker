import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BridgesService } from './bridges.service';
import { OrbiterBridge } from './entities/orbiter-bridge.entity';
import { OrbiterRow } from './orbiter.client';

const repo = {
  find: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  count: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const row: OrbiterRow = {
  status: 99,
  sourceId: '0xAAA111', targetId: '0xBBB222',
  sourceChain: '42161', targetChain: '8453',
  sourceAmount: '2.5', sourceSymbol: 'ETH',
  sourceTime: '2026-06-01T00:00:00.000Z', sourceAmountUSD: '4300.55',
};

describe('BridgesService', () => {
  let service: BridgesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod: TestingModule = await Test.createTestingModule({
      providers: [BridgesService, { provide: getRepositoryToken(OrbiterBridge), useValue: repo }],
    }).compile();
    service = mod.get(BridgesService);
  });

  it('maps a feed row to a lowercased, typed entity with chain classifiers', () => {
    const e = service.rowToEntity(row);
    expect(e.sourceId).toBe('0xaaa111');
    expect(e.targetId).toBe('0xbbb222');
    expect(e.amount).toBe(2.5);
    expect(e.usd).toBeCloseTo(4300.55);
    expect(e.sourceTime).toEqual(new Date('2026-06-01T00:00:00.000Z'));
    expect(e.enriched).toBe(false);
    expect(e.sender).toBeNull();
    // chain name/net classifiers resolved from the registry
    expect(e.sourceChainName).toBe('Arbitrum');
    expect(e.sourceNet).toBe('ARBITRUM');
    expect(e.targetChainName).toBe('Base');
    expect(e.targetNet).toBe('BASE');
  });

  it('reclassify updates rows per chain and counts affected', async () => {
    repo.update.mockResolvedValue({ affected: 1 });
    const n = await service.reclassify();
    expect(repo.update).toHaveBeenCalled();
    expect(n).toBeGreaterThan(0);
  });

  it('upsertMany inserts only rows that do not already exist', async () => {
    const a = service.rowToEntity({ ...row, sourceId: '0xA' });
    const b = service.rowToEntity({ ...row, sourceId: '0xB' });
    repo.find.mockResolvedValue([{ sourceId: '0xa' }]); // 0xA already stored
    repo.insert.mockResolvedValue({});

    const added = await service.upsertMany([a, b]);

    expect(added).toBe(1);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.insert.mock.calls[0][0]).toHaveLength(1);
    expect(repo.insert.mock.calls[0][0][0].sourceId).toBe('0xb');
  });

  it('upsertMany with all-existing inserts nothing', async () => {
    const a = service.rowToEntity({ ...row, sourceId: '0xA' });
    repo.find.mockResolvedValue([{ sourceId: '0xa' }]);
    const added = await service.upsertMany([a]);
    expect(added).toBe(0);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('byAddress lowercases the address and caps the limit', async () => {
    repo.find.mockResolvedValue([]);
    await service.byAddress('0xDEAD', 5000);
    const opts = repo.find.mock.calls[0][0];
    expect(opts.where).toEqual([
      { sender: '0xdead' }, { receiver: '0xdead' }, { targetAddress: '0xdead' },
    ]);
    expect(opts.take).toBe(1000); // capped
  });
});
