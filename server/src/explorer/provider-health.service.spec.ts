import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProviderHealthService } from './provider-health.service';
import { ProviderHealthEntry } from './entities/provider-health.entity';

// In-memory stand-in for the Postgres table, keyed by source — mirrors the
// mock-repository convention used across this codebase's *.service.spec.ts
// (e.g. projects.service.spec.ts), rather than hitting a real DB in unit tests.
describe('ProviderHealthService', () => {
  let health: ProviderHealthService;
  let rows: Map<string, ProviderHealthEntry>;
  const mockRepo = {
    findOneBy: jest.fn(({ source }: { source: string }) => Promise.resolve(rows.get(source) ?? null)),
    create: jest.fn((v: Partial<ProviderHealthEntry>) => ({ ...v }) as ProviderHealthEntry),
    save: jest.fn((v: ProviderHealthEntry) => { rows.set(v.source, v); return Promise.resolve(v); }),
    find: jest.fn(() => Promise.resolve([...rows.values()].sort((a, b) => a.source.localeCompare(b.source)))),
  };

  beforeEach(async () => {
    rows = new Map();
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProviderHealthService, { provide: getRepositoryToken(ProviderHealthEntry), useValue: mockRepo }],
    }).compile();
    health = module.get(ProviderHealthService);
    jest.spyOn(health['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(health['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(health['logger'], 'error').mockImplementation(() => undefined);
  });

  it('starts empty', async () => {
    expect(await health.snapshot()).toEqual([]);
  });

  it('records a healthy call', async () => {
    await health.record('bscscan.com', 'ok', { latencyMs: 120 });
    const [s] = await health.snapshot();
    expect(s.status).toBe('ok');
    expect(s.totalOk).toBe(1);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.lastOkAt).toBeGreaterThan(0);
    expect(s.lastLatencyMs).toBe(120);
  });

  it('treats empty (reachable, no data) as healthy', async () => {
    await health.record('etherscan:ETH', 'empty');
    expect(await health.degraded('etherscan:ETH')).toBe(false);
    expect((await health.snapshot())[0].totalOk).toBe(1);
  });

  it('counts consecutive failures and flags degraded after the threshold', async () => {
    await health.record('bscscan.com', 'down');
    expect(await health.degraded('bscscan.com')).toBe(false);
    await health.record('bscscan.com', 'down');
    await health.record('bscscan.com', 'down');
    expect(await health.degraded('bscscan.com')).toBe(true);
    const [s] = await health.snapshot();
    expect(s.consecutiveFailures).toBe(3);
    expect(s.totalFail).toBe(3);
    expect(s.status).toBe('down');
  });

  it('resets the failure streak on recovery', async () => {
    await health.record('bscscan.com', 'down');
    await health.record('bscscan.com', 'down');
    await health.record('bscscan.com', 'ok');
    expect(await health.degraded('bscscan.com')).toBe(false);
    const [s] = await health.snapshot();
    expect(s.consecutiveFailures).toBe(0);
    expect(s.status).toBe('ok');
  });

  it('tracks drift distinctly and logs it at error level', async () => {
    const errSpy = jest.spyOn(health['logger'], 'error');
    await health.record('bscscan.com', 'drift', { note: 'markup changed' });
    const [s] = await health.snapshot();
    expect(s.status).toBe('drift');
    expect(s.totalDrift).toBe(1);
    expect(s.lastDriftAt).toBeGreaterThan(0);
    expect(errSpy).toHaveBeenCalled();
  });

  it('snapshot is sorted by source name', async () => {
    await health.record('zzz', 'ok');
    await health.record('aaa', 'ok');
    expect((await health.snapshot()).map((s) => s.source)).toEqual(['aaa', 'zzz']);
  });
});
