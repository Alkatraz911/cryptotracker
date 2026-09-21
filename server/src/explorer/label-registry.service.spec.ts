import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LabelRegistryService, labelKey } from './label-registry.service';
import { AddressLabel } from './entities/address-label.entity';

const rows: AddressLabel[] = [];
const mockRepo = {
  find: jest.fn(async () => rows),
  upsert: jest.fn(async (r: AddressLabel | AddressLabel[]) => {
    for (const x of Array.isArray(r) ? r : [r]) {
      const i = rows.findIndex((y) => y.address === x.address);
      if (i >= 0) rows[i] = { ...rows[i], ...x }; else rows.push({ ...x } as AddressLabel);
    }
  }),
  findOneByOrFail: jest.fn(async ({ address }: { address: string }) => rows.find((r) => r.address === address)),
  delete: jest.fn(async ({ address }: { address: string }) => { const i = rows.findIndex((r) => r.address === address); if (i >= 0) rows.splice(i, 1); }),
};

const TRON = 'TLXZxKcduSDxXQynpoCatnY5S4ET9SNACP';
const flush = () => new Promise((r) => setImmediate(r));

describe('LabelRegistryService', () => {
  let service: LabelRegistryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    rows.length = 0;
    const module: TestingModule = await Test.createTestingModule({
      providers: [LabelRegistryService, { provide: getRepositoryToken(AddressLabel), useValue: mockRepo }],
    }).compile();
    service = module.get(LabelRegistryService);
  });

  it('normalises EVM addresses to lowercase but keeps TRON/Solana case', () => {
    expect(labelKey('0xABCDEFabcdef0123456789ABCDEFabcdef012345')).toBe('0xabcdefabcdef0123456789abcdefabcdef012345');
    expect(labelKey(TRON)).toBe(TRON);
  });

  it('stores a human label and finds it case-insensitively for EVM', async () => {
    await service.set({ address: '0xABCDEFabcdef0123456789ABCDEFabcdef012345', label: ' Binance 14 ', by: 'a@b.c' });
    const hit = await service.forAddress('0xabcdefabcdef0123456789abcdefabcdef012345');
    expect(hit?.label).toBe('Binance 14');
    expect(hit?.source).toBe('manual');
    expect(hit?.createdBy).toBe('a@b.c');
  });

  it('remember() fills a gap but never overwrites a human entry', async () => {
    service.remember(TRON, 'Bybit', 'tronscan');
    await flush();
    expect((await service.forAddress(TRON))?.label).toBe('Bybit');

    await service.set({ address: TRON, label: 'FixedFloat. User', source: 'okx' });
    service.remember(TRON, 'Something else', 'tronscan');
    await flush();
    expect((await service.forAddress(TRON))?.label).toBe('FixedFloat. User');
  });

  it('a human entry replaces an explorer tag', async () => {
    service.remember(TRON, 'Bybit', 'tronscan');
    await flush();
    await service.set({ address: TRON, label: 'Bybit: Deposit', source: 'manual' });
    expect((await service.forAddress(TRON))?.label).toBe('Bybit: Deposit');
  });

  it('bulk-imports, skipping blank rows, and removes', async () => {
    const n = await service.setMany([{ address: TRON, label: 'X' }, { address: '0x1111111111111111111111111111111111111111', label: '  ' }], 'a@b.c');
    expect(n).toBe(1);
    await service.remove(TRON);
    expect(await service.forAddress(TRON)).toBeUndefined();
  });
});
