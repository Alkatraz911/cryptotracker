"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const explorer_service_1 = require("./explorer.service");
const evm_provider_1 = require("./providers/evm.provider");
const tron_provider_1 = require("./providers/tron.provider");
const solana_provider_1 = require("./providers/solana.provider");
const orbiter_provider_1 = require("./providers/orbiter.provider");
const debridge_provider_1 = require("./providers/debridge.provider");
const price_provider_1 = require("./providers/price.provider");
const bridge_registry_service_1 = require("./bridge-registry.service");
const bridge_hub_service_1 = require("./bridges/bridge-hub.service");
const provider_health_service_1 = require("./provider-health.service");
const mockEvm = { fetchTx: jest.fn(), fetchAddressLabel: jest.fn().mockResolvedValue({ label: null }), fetchWalletTransfers: jest.fn() };
const mockTron = { fetchTx: jest.fn(), fetchAddressLabel: jest.fn().mockResolvedValue({ label: null }), fetchWalletTransfers: jest.fn() };
const mockSolana = { fetchTx: jest.fn(), fetchAddressLabel: jest.fn().mockResolvedValue({ label: null }), fetchWalletTransfers: jest.fn() };
const mockOrbiter = { resolve: jest.fn(), feed: jest.fn() };
const mockDebridge = { resolve: jest.fn(), feed: jest.fn() };
const mockPrice = { pricesFor: jest.fn().mockResolvedValue(new Map()) };
const mockBridgeRegistry = { forAddress: jest.fn(), list: jest.fn(), add: jest.fn(), remove: jest.fn() };
const mockHub = { resolve: jest.fn(), resolveAny: jest.fn(), has: jest.fn(), resolvers: jest.fn() };
const mockHealth = { record: jest.fn(), snapshot: jest.fn().mockReturnValue([]), degraded: jest.fn().mockReturnValue(false) };
describe('ExplorerService', () => {
    let service;
    beforeEach(async () => {
        jest.clearAllMocks();
        mockBridgeRegistry.forAddress.mockResolvedValue(undefined);
        const module = await testing_1.Test.createTestingModule({
            providers: [
                explorer_service_1.ExplorerService,
                { provide: evm_provider_1.EvmProvider, useValue: mockEvm },
                { provide: tron_provider_1.TronProvider, useValue: mockTron },
                { provide: solana_provider_1.SolanaProvider, useValue: mockSolana },
                { provide: orbiter_provider_1.OrbiterProvider, useValue: mockOrbiter },
                { provide: debridge_provider_1.DebridgeProvider, useValue: mockDebridge },
                { provide: price_provider_1.PriceProvider, useValue: mockPrice },
                { provide: bridge_registry_service_1.BridgeRegistryService, useValue: mockBridgeRegistry },
                { provide: bridge_hub_service_1.BridgeHubService, useValue: mockHub },
                { provide: provider_health_service_1.ProviderHealthService, useValue: mockHealth },
            ],
        }).compile();
        service = module.get(explorer_service_1.ExplorerService);
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
        mockEvm.fetchAddressLabel.mockResolvedValue({ label: 'Binance' });
        const r = await service.fetchAddressLabel('ETH', '0x1111111111111111111111111111111111111111');
        expect(r.label).toBe('Binance');
        expect(mockEvm.fetchAddressLabel).toHaveBeenCalled();
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
//# sourceMappingURL=explorer.service.spec.js.map