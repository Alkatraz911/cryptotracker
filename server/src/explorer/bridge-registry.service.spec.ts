import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BridgeRegistryService } from './bridge-registry.service';
import { BridgeAddress } from './entities/bridge-address.entity';

describe('BridgeRegistryService', () => {
  const repo = { find: jest.fn(), upsert: jest.fn(), findOneByOrFail: jest.fn(), delete: jest.fn() };
  let svc: BridgeRegistryService;
  const ADDR = '0x' + 'ab'.repeat(20);

  beforeEach(async () => {
    jest.clearAllMocks();
    repo.find.mockResolvedValue([{ address: ADDR, bridge: 'orbiter', name: 'Orbiter Finance: Maker' }]);
    const m: TestingModule = await Test.createTestingModule({
      providers: [BridgeRegistryService, { provide: getRepositoryToken(BridgeAddress), useValue: repo }],
    }).compile();
    svc = m.get(BridgeRegistryService);
  });

  it('matches case-insensitively and caches the table', async () => {
    const a = await svc.forAddress(ADDR.toUpperCase());
    const b = await svc.forAddress(ADDR);
    expect(a?.bridge).toBe('orbiter');
    expect(b?.name).toMatch(/Orbiter/);
    expect(repo.find).toHaveBeenCalledTimes(1); // second lookup served from cache
  });

  it('returns undefined for unknown addresses', async () => {
    expect(await svc.forAddress('0x' + '11'.repeat(20))).toBeUndefined();
    expect(await svc.forAddress(null)).toBeUndefined();
  });

  it('invalidates the cache when an entry is added', async () => {
    await svc.forAddress(ADDR); // loads + caches
    repo.findOneByOrFail.mockResolvedValue({ address: '0xnew', bridge: 'debridge', name: 'deBridge' });
    await svc.add({ address: '0xNEW', bridge: 'debridge', name: 'deBridge' });
    expect(repo.upsert).toHaveBeenCalledWith({ address: '0xnew', bridge: 'debridge', name: 'deBridge' }, ['address']);
    await svc.forAddress(ADDR); // cache invalidated → re-query
    expect(repo.find).toHaveBeenCalledTimes(2);
  });
});
