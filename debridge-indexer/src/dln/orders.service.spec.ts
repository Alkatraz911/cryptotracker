import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrdersService } from './orders.service';
import { DebridgeOrder } from './entities/debridge-order.entity';
import { DlnOrder } from './dln.client';

const repo = {
  find: jest.fn(), insert: jest.fn(), update: jest.fn(),
  count: jest.fn(), findOne: jest.fn(), createQueryBuilder: jest.fn(),
};

const listOrder: DlnOrder = {
  orderId: { stringValue: '0xABC' },
  creationTimestamp: 1781600000,
  giveOfferWithMetadata: { chainId: { stringValue: '56' }, amount: { stringValue: '1000000000000000000' }, decimals: 18, symbol: 'ETH' },
  takeOfferWithMetadata: { chainId: { stringValue: '8453' }, amount: { stringValue: '990000000000000000' }, decimals: 18, symbol: 'ETH' },
  createEventTransactionHash: { stringValue: '0xSRC' },
  state: 'Fulfilled',
};

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod: TestingModule = await Test.createTestingModule({
      providers: [OrdersService, { provide: getRepositoryToken(DebridgeOrder), useValue: repo }],
    }).compile();
    service = mod.get(OrdersService);
  });

  it('maps a list order to an entity with chain classifiers', () => {
    const e = service.toEntity(listOrder)!;
    expect(e.orderId).toBe('0xabc');
    expect(e.srcTx).toBe('0xsrc');
    expect(e.giveChain).toBe('56');
    expect(e.giveChainName).toBe('BSC');
    expect(e.giveNet).toBe('BSC');
    expect(e.takeChainName).toBe('Base');
    expect(e.giveAmount).toBeCloseTo(1);
    expect(e.enriched).toBe(false); // list has no sender/dstTx
    expect(e.creationTime).toEqual(new Date(1781600000 * 1000));
  });

  it('upsertMany inserts only new orders', async () => {
    const a = service.toEntity({ ...listOrder, orderId: { stringValue: '0xA' } })!;
    const b = service.toEntity({ ...listOrder, orderId: { stringValue: '0xB' } })!;
    repo.find.mockResolvedValue([{ orderId: '0xa' }]);
    repo.insert.mockResolvedValue({});
    const added = await service.upsertMany([a, b]);
    expect(added).toBe(1);
    expect(repo.insert.mock.calls[0][0][0].orderId).toBe('0xb');
  });

  it('byAddress lowercases and caps limit', async () => {
    repo.find.mockResolvedValue([]);
    await service.byAddress('0xDEAD', 5000);
    const opts = repo.find.mock.calls[0][0];
    expect(opts.where).toEqual([{ sender: '0xdead' }, { receiver: '0xdead' }]);
    expect(opts.take).toBe(1000);
  });
});
