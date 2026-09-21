import { Test, TestingModule } from '@nestjs/testing';
import { ExplorerService } from './explorer.service';
import { EvmProvider } from './providers/evm.provider';
import { TronProvider } from './providers/tron.provider';
import { SolanaProvider } from './providers/solana.provider';
import { OrbiterProvider } from './providers/orbiter.provider';
import { DebridgeProvider } from './providers/debridge.provider';
import { PriceProvider } from './providers/price.provider';
import { OkLinkProvider } from './providers/oklink.provider';
import { BridgeRegistryService } from './bridge-registry.service';
import { BridgeHubService } from './bridges/bridge-hub.service';
import { ProviderHealthService } from './provider-health.service';

const mockEvm = { fetchTx: jest.fn(), fetchAddressLabel: jest.fn().mockResolvedValue({ label: null }), fetchWalletTransfers: jest.fn() };
const mockTron = { fetchTx: jest.fn(), fetchAddressLabel: jest.fn().mockResolvedValue({ label: null }), fetchWalletTransfers: jest.fn() };
const mockSolana = { fetchTx: jest.fn(), fetchAddressLabel: jest.fn().mockResolvedValue({ label: null }), fetchWalletTransfers: jest.fn() };
const mockOrbiter = { resolve: jest.fn(), feed: jest.fn() };
const mockDebridge = { resolve: jest.fn(), feed: jest.fn() };
const mockPrice = { pricesFor: jest.fn().mockResolvedValue(new Map()) };
const mockOkLink = { fetchEntityLabel: jest.fn().mockResolvedValue(null), enabled: false };
const mockBridgeRegistry = { forAddress: jest.fn(), list: jest.fn(), add: jest.fn(), remove: jest.fn() };
const mockHub = { resolve: jest.fn(), resolveAny: jest.fn(), has: jest.fn(), resolvers: jest.fn() };
const mockHealth = { record: jest.fn(), snapshot: jest.fn().mockReturnValue([]), degraded: jest.fn().mockReturnValue(false) };

describe('ExplorerService', () => {
  let service: ExplorerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockBridgeRegistry.forAddress.mockResolvedValue(undefined);
    mockOkLink.fetchEntityLabel.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExplorerService,
        { provide: EvmProvider, useValue: mockEvm },
        { provide: TronProvider, useValue: mockTron },
        { provide: SolanaProvider, useValue: mockSolana },
        { provide: OrbiterProvider, useValue: mockOrbiter },
        { provide: DebridgeProvider, useValue: mockDebridge },
        { provide: PriceProvider, useValue: mockPrice },
        { provide: OkLinkProvider, useValue: mockOkLink },
        { provide: BridgeRegistryService, useValue: mockBridgeRegistry },
        { provide: BridgeHubService, useValue: mockHub },
        { provide: ProviderHealthService, useValue: mockHealth },
      ],
    }).compile();
    service = module.get(ExplorerService);
  });

  it('routes TRON to tron provider', async () => {
    mockTron.fetchTx.mockResolvedValue({ network: 'TRON', hash: 'abc' });
    await service.fetchTx('TRON', 'abc');
    expect(mockTron.fetchTx).toHaveBeenCalledWith('abc');
    expect(mockEvm.fetchTx).not.toHaveBeenCalled();
  });

  it('routes SOLANA to solana provider', async () => {
    mockSolana.fetchTx.mockResolvedValue({ network: 'SOLANA', hash: 'sig1' });
    await service.fetchTx('SOLANA', 'sig1');
    expect(mockSolana.fetchTx).toHaveBeenCalledWith('sig1');
  });

  it('routes ETH to evm provider', async () => {
    mockEvm.fetchTx.mockResolvedValue({ network: 'ETH', hash: '0x1' });
    await service.fetchTx('ETH', '0x1');
    expect(mockEvm.fetchTx).toHaveBeenCalledWith('ETH', '0x1');
  });

  it('returns null and logs on error', async () => {
    mockEvm.fetchTx.mockRejectedValue(new Error('network error'));
    const result = await service.fetchTx('ETH', '0xbad');
    expect(result).toBeNull();
  });

  it('labels known bridge addresses from the registry without calling the explorer', async () => {
    mockBridgeRegistry.forAddress.mockResolvedValue({ bridge: 'debridge', name: 'deBridge: DLN Source' });
    const r = await service.fetchAddressLabel('ETH', '0xeF4fB24aD0916217251F553c0596F8EdC630EB66');
    expect(r.label).toMatch(/deBridge/i);
    expect(mockEvm.fetchAddressLabel).not.toHaveBeenCalled();
  });

  it('falls through to the explorer for non-bridge addresses', async () => {
    mockBridgeRegistry.forAddress.mockResolvedValue(undefined);
    mockOkLink.fetchEntityLabel.mockResolvedValue(null);
    mockEvm.fetchAddressLabel.mockResolvedValue({ label: 'Binance' });
    const r = await service.fetchAddressLabel('ETH', '0x1111111111111111111111111111111111111111');
    expect(r.label).toBe('Binance');
    expect(mockEvm.fetchAddressLabel).toHaveBeenCalled();
  });

  it('prefers an OKLink entity label over the chain explorer on EVM', async () => {
    mockOkLink.fetchEntityLabel.mockResolvedValue('FixedFloat. User');
    mockEvm.fetchAddressLabel.mockResolvedValue({ label: 'SomeContract' });
    const r = await service.fetchAddressLabel('ETH', '0x1111111111111111111111111111111111111111');
    expect(r.label).toBe('FixedFloat. User');
    expect(mockEvm.fetchAddressLabel).not.toHaveBeenCalled();
  });

  it('on TRON asks TronScan first and only falls back to OKLink when it has no tag', async () => {
    mockOkLink.fetchEntityLabel.mockResolvedValue('FixedFloat. User');
    mockTron.fetchAddressLabel.mockResolvedValue({ label: null });
    const r = await service.fetchAddressLabel('TRON', 'TLXZxKcduSDxXQynpoCatnY5S4ET9SNACP');
    expect(r.label).toBe('FixedFloat. User');
    expect(mockOkLink.fetchEntityLabel).toHaveBeenCalledWith('TRON', 'TLXZxKcduSDxXQynpoCatnY5S4ET9SNACP');

    mockOkLink.fetchEntityLabel.mockClear();
    mockTron.fetchAddressLabel.mockResolvedValue({ label: 'Bybit' });
    const r2 = await service.fetchAddressLabel('TRON', 'TLXZxKcduSDxXQynpoCatnY5S4ET9SNACP');
    expect(r2.label).toBe('Bybit');
    expect(mockOkLink.fetchEntityLabel).not.toHaveBeenCalled();
  });

  describe('bridgeResolve dispatches via the bridge hub', () => {
    it('a known bridge is resolved EXCLUSIVELY by its adapter (no probing)', async () => {
      mockHub.resolve.mockResolvedValue({ hop: null, outOfRange: false });
      await service.bridgeResolve('0xh', undefined, undefined, true, 'lifi');
      expect(mockHub.resolve).toHaveBeenCalledWith('lifi', '0xh', expect.objectContaining({ fast: true }));
      expect(mockHub.resolveAny).not.toHaveBeenCalled();
    });

    it('with no hint, probes all adapters via resolveAny', async () => {
      mockHub.resolveAny.mockResolvedValue({ hop: null, outOfRange: false });
      await service.bridgeResolve('0xh');
      expect(mockHub.resolveAny).toHaveBeenCalledWith('0xh', expect.any(Object));
      expect(mockHub.resolve).not.toHaveBeenCalled();
    });
  });

  it('filters transfers with amount < 1 for non-native assets', async () => {
    mockEvm.fetchWalletTransfers.mockResolvedValue({
      transfers: [
        { network: 'ETH', hash: '1', from: 'a', to: 'b', amount: 0.001, asset: 'SHIB', timestamp: 1000 },
        { network: 'ETH', hash: '2', from: 'a', to: 'b', amount: 100, asset: 'USDC', timestamp: 2000 },
      ],
      diag: null,
    });
    const result = await service.fetchWalletTransfers('ETH', '0xaddr', { native: true, token: true, limit: 50 });
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].hash).toBe('2');
  });

  it('records source health and threads a parse-drift status through', async () => {
    mockEvm.fetchWalletTransfers.mockResolvedValue({ transfers: [], diag: 'разметка изменилась', status: 'drift', source: 'bscscan.com' });
    const result = await service.fetchWalletTransfers('BSC', '0xaddr', { native: true, token: true, limit: 50 });
    expect(result.status).toBe('drift');
    expect(mockHealth.record).toHaveBeenCalledWith('bscscan.com', 'drift', expect.objectContaining({ note: 'разметка изменилась' }));
  });

  it('infers ok health for a provider that returns transfers without a status', async () => {
    mockEvm.fetchWalletTransfers.mockResolvedValue({
      transfers: [{ network: 'ETH', hash: '1', from: 'a', to: 'b', amount: 100, asset: 'USDC', timestamp: 1000 }],
      diag: null,
    });
    await service.fetchWalletTransfers('ETH', '0xaddr', { native: true, token: true, limit: 50 });
    expect(mockHealth.record).toHaveBeenCalledWith('ETH', 'ok', expect.any(Object));
  });
});
