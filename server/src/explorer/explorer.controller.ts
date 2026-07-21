import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ExplorerService } from './explorer.service';
import { BridgeRegistryService } from './bridge-registry.service';
import { BridgeHubService } from './bridges/bridge-hub.service';
import { ProviderHealthService } from './provider-health.service';
import { AddBridgeDto } from './dto/add-bridge.dto';

@Controller('explorer')
@UseGuards(JwtAuthGuard)
export class ExplorerController {
  constructor(
    private readonly explorer: ExplorerService,
    private readonly bridges: BridgeRegistryService,
    private readonly bridgeHub: BridgeHubService,
    private readonly health: ProviderHealthService,
  ) {}

  // Health of the (scraping/undocumented-API) data sources, as observed from real
  // traffic — lets the operator see which explorer is down or has drifted instead
  // of guessing from a silent zero.
  @Get('health')
  async sourceHealth() {
    const sources = await this.health.snapshot();
    const degraded = sources.filter((s) => s.status === 'down' || s.status === 'drift');
    return { generatedAt: Date.now(), ok: degraded.length === 0, degraded: degraded.map((s) => s.source), sources };
  }

  // Bridges that support cross-chain resolution (authed — drives the UI button).
  @Get('bridges/resolvers')
  listResolvers() {
    return this.bridgeHub.resolvers();
  }

  // ── Bridge address registry — admin only (editable at runtime, no rebuild) ──
  @Get('bridges')
  @UseGuards(AdminGuard)
  listBridges() {
    return this.bridges.list();
  }

  @Post('bridges')
  @UseGuards(AdminGuard)
  addBridge(@Body() dto: AddBridgeDto) {
    return this.bridges.add(dto);
  }

  @Delete('bridges/:address')
  @UseGuards(AdminGuard)
  async removeBridge(@Param('address') address: string) {
    await this.bridges.remove(address);
    return { ok: true };
  }

  @Get('tx')
  async getTx(@Query('network') network: string, @Query('hash') hash: string) {
    if (!network || !hash) return { data: null, diag: null };
    try {
      const data = await this.explorer.fetchTx(network.toUpperCase(), hash);
      return { data, diag: data ? null : `${network}: RPC вернул пустой ответ (tx не найдена или RPC недоступен)` };
    } catch (e) {
      return { data: null, diag: String((e as Error)?.message || e) };
    }
  }

  @Get('label')
  getLabel(@Query('network') network: string, @Query('address') address: string) {
    if (!network || !address) return { label: null };
    return this.explorer.fetchAddressLabel(network.toUpperCase(), address);
  }

  @Get('wallet')
  getWallet(
    @Query('network') network: string,
    @Query('address') address: string,
    @Query('native') native: string,
    @Query('token') token: string,
    @Query('limit') limit: string,
    @Query('labels') labels: string,
  ) {
    if (!network || !address) return { transfers: [] };
    return this.explorer.fetchWalletTransfers(network.toUpperCase(), address, {
      native: native !== 'false',
      token: token !== 'false',
      limit: limit ? Number(limit) : 50,
      labels: labels !== 'false',
    });
  }

  // Native on-chain balance for a wallet (priced in USD where available).
  @Get('balance')
  async getBalance(@Query('network') network: string, @Query('address') address: string) {
    if (!network || !address) return { amount: null, asset: '', usdValue: null, diag: 'network и address обязательны' };
    return this.explorer.fetchBalance(network.toUpperCase(), address);
  }

  // Auto-trace value flow from a wallet ("follow the money").
  @Get('trace')
  async trace(
    @Query('network') network: string,
    @Query('address') address: string,
    @Query('direction') direction: string,
    @Query('hops') hops: string,
    @Query('minUsd') minUsd: string,
    @Query('perNode') perNode: string,
  ) {
    if (!network || !address) return { transfers: [], hops: [], terminals: [], stats: {}, diag: 'network и address обязательны' };
    return this.explorer.traceFlow({
      network: network.toUpperCase(),
      address,
      direction: direction === 'in' ? 'in' : 'out',
      maxHops: hops ? Number(hops) : undefined,
      minUsd: minUsd ? Number(minUsd) : undefined,
      perNode: perNode ? Number(perNode) : undefined,
    });
  }

  // Resolve a tx hash to its cross-chain counterpart via the detected bridge.
  // `bridge` is the bridge id (any registered adapter); empty → probe all.
  @Get('orbiter/resolve')
  async orbiterResolve(
    @Query('hash') hash: string,
    @Query('chainId') chainId: string,
    @Query('ts') ts: string,
    @Query('bridge') bridge: string,
  ) {
    if (!hash) return { hop: null, diag: 'hash обязателен' };
    const prefer = bridge || undefined;
    const { hop, outOfRange } = await this.explorer.bridgeResolve(hash, chainId || undefined, ts ? Number(ts) : undefined, false, prefer);
    const diag = hop ? null
      : outOfRange ? 'Мост: транзакция старше доступной глубины (резолв работает по недавней истории)'
      : 'Мост: кроссчейн-перевод для этой транзакции не найден';
    return { hop, diag };
  }

  // Import a window of deBridge (DLN) cross-chain orders.
  @Get('debridge/feed')
  async debridgeFeed(
    @Query('source') source: string,
    @Query('target') target: string,
    @Query('minUsd') minUsd: string,
    @Query('since') since: string,
    @Query('limit') limit: string,
  ) {
    return this.explorer.debridgeFeed({
      sourceChain: source || undefined,
      targetChain: target || undefined,
      minUsd: minUsd ? Number(minUsd) : undefined,
      sinceMs: since ? Number(since) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // Import a chain-pair feed of Orbiter bridge transfers.
  @Get('orbiter/feed')
  async orbiterFeed(
    @Query('source') source: string,
    @Query('target') target: string,
    @Query('minUsd') minUsd: string,
    @Query('since') since: string,
    @Query('until') until: string,
    @Query('limit') limit: string,
  ) {
    if (!source) return { hops: [], diag: 'source (сеть-источник) обязательна' };
    return this.explorer.orbiterFeed({
      sourceChain: source,
      targetChain: target || undefined,
      minUsd: minUsd ? Number(minUsd) : undefined,
      sinceMs: since ? Number(since) : undefined,
      untilMs: until ? Number(until) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
