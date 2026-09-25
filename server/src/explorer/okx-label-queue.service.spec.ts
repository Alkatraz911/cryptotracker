import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OkxLabelQueueService } from './okx-label-queue.service';
import { OkxLabelTask } from './entities/okx-label-task.entity';
import { LabelRegistryService } from './label-registry.service';

const mockRepo = { query: jest.fn() };
const mockLabels = { forAddress: jest.fn(), learn: jest.fn() };

const A = 'TLXZxKcduSDxXQynpoCatnY5S4ET9SNACP';
const B = 'TDoXUNZ6PajKuiUkcYg3EDSV9bnqGqsbcf';
const flush = () => new Promise((r) => setImmediate(r));
const sqlCalls = (re: RegExp) => mockRepo.query.mock.calls.filter(([sql]) => re.test(sql));

describe('OkxLabelQueueService', () => {
  let service: OkxLabelQueueService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRepo.query.mockResolvedValue([]);
    mockLabels.forAddress.mockResolvedValue(undefined);
    mockLabels.learn.mockImplementation(async (e: Array<{ address: string }>) => e.map((x) => x.address));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OkxLabelQueueService,
        { provide: getRepositoryToken(OkxLabelTask), useValue: mockRepo },
        { provide: LabelRegistryService, useValue: mockLabels },
      ],
    }).compile();
    service = module.get(OkxLabelQueueService);
  });

  it('queues an unlabelled address once, and again only to add a tx hash', async () => {
    service.enqueue('TRON', A);
    service.enqueue('TRON', A);
    await flush();
    expect(sqlCalls(/INSERT INTO okx_label_queue/)).toHaveLength(1);
    service.enqueue('TRON', A, '0xhash');
    service.enqueue('TRON', A, '0xhash');
    await flush();
    const ins = sqlCalls(/INSERT INTO okx_label_queue/);
    expect(ins).toHaveLength(2);
    expect(ins[1][1]).toEqual([A, 'TRON', '0xhash']);
  });

  it('skips addresses a person or OKX already labelled, but not explorer tags', async () => {
    mockLabels.forAddress.mockResolvedValueOnce({ label: 'FixedFloat. User', source: 'okx' });
    service.enqueue('TRON', A, 'h1');
    mockLabels.forAddress.mockResolvedValueOnce({ label: 'Bybit', source: 'tronscan' });
    service.enqueue('TRON', B, 'h2');
    await flush();
    const ins = sqlCalls(/INSERT INTO okx_label_queue/);
    expect(ins).toHaveLength(1);
    expect(ins[0][1][0]).toBe(B);
  });

  it('hands out a claimed task (UPDATE … RETURNING comes back as [rows, count])', async () => {
    mockRepo.query.mockResolvedValueOnce([[{ address: A, network: 'TRON', tx_hash: 'h1' }], 1]);
    expect(await service.claim('me@x')).toEqual({ address: A, network: 'TRON', txHash: 'h1' });
  });

  it('closes a task that got an OKX label meanwhile and hands out the next one', async () => {
    mockRepo.query
      .mockResolvedValueOnce([[{ address: A, network: 'TRON', tx_hash: 'h1' }], 1])
      .mockResolvedValueOnce([[], 1]) // markDone
      .mockResolvedValueOnce([[{ address: B, network: 'TRON', tx_hash: 'h2' }], 1]);
    mockLabels.forAddress.mockResolvedValueOnce({ label: 'x', source: 'okx' }).mockResolvedValueOnce(undefined);
    expect((await service.claim('me@x'))?.address).toBe(B);
    expect(sqlCalls(/SET status = 'done'/)[0][1]).toEqual([[A]]);
  });

  it('returns null when the queue is empty', async () => {
    mockRepo.query.mockResolvedValueOnce([[], 0]);
    expect(await service.claim('me@x')).toBeNull();
  });

  it('a report saves every tag on the page and closes those addresses', async () => {
    const r = await service.report('me@x', {
      address: A, status: 'found',
      labels: [{ address: A, label: 'Exchange: FixedFloat. User' }, { address: B, label: 'Exchange: FixedFloat. DepositAndWithdraw_2' }],
    });
    expect(r.saved).toBe(2);
    expect(mockLabels.learn).toHaveBeenCalledWith(expect.any(Array), 'okx', 'me@x');
    expect(sqlCalls(/SET status = 'done'/)[0][1]).toEqual([[A, B]]);
    expect(sqlCalls(/SET status = \$2/)).toHaveLength(0);
  });

  it('a report without the claimed address marks it none / failed', async () => {
    await service.report('me@x', { address: A, status: 'none', labels: [{ address: B, label: 'Binance' }] });
    await service.report('me@x', { address: B, status: 'failed', labels: [], error: 'page did not render' });
    const upd = sqlCalls(/SET status = \$2/);
    expect(upd[0][1]).toEqual([A, 'none', null]);
    expect(upd[1][1]).toEqual([B, 'failed', 'page did not render']);
  });
});
