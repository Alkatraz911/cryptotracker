import { Injectable, Logger } from '@nestjs/common';
import { EvmProvider, TransferItem } from './providers/evm.provider';
import { TronProvider } from './providers/tron.provider';
import { SolanaProvider } from './providers/solana.provider';
import { OrbiterProvider, OrbiterHop } from './providers/orbiter.provider';
import { DebridgeProvider } from './providers/debridge.provider';
import { PriceProvider } from './providers/price.provider';
import { BridgeRegistryService } from './bridge-registry.service';
import { BridgeHubService } from './bridges/bridge-hub.service';
import { ProviderHealthService, SourceStatus } from './provider-health.service';

const NATIVE_ASSETS = new Set(['ETH', 'BNB', 'POL', 'TRX', 'SOL']);
const MAX_TRANSFERS = 2000;     // practical ceiling for "full history" in one load
const MAX_LABELS = 20;          // cap address-tag lookups per request (they're slow/heavy)
const TRACE_SUPPORTED = new Set(['ETH', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'TRON', 'SOLANA']);
const walletKey = (net: string, addr: string) =>
  /^0x[0-9a-fA-F]{40}$/.test(addr) ? `EVM:${addr.toLowerCase()}` : `${net}:${addr}`;

// A bridge id (adapter slug, e.g. 'orbiter' | 'debridge' | 'lifi', or any
// detection-only id from the address registry).
export type BridgeName = string;

@Injectable()
export class ExplorerService {
  private readonly logger = new Logger(ExplorerService.name);

  constructor(
    private readonly evm: EvmProvider,
    private readonly tron: TronProvider,
    private readonly solana: SolanaProvider,
    private readonly orbiter: OrbiterProvider,
    private readonly debridge: DebridgeProvider,
    private readonly price: PriceProvider,
    private readonly bridgeRegistry: BridgeRegistryService,
    private readonly bridges: BridgeHubService,
    private readonly health: ProviderHealthService,
  ) {}

  // ── Cross-chain bridges (Orbiter + deBridge) ───────────────────────────────
  // Resolve a tx hash through a bridge. `prefer` (from the node's tag) routes to
  // the right bridge first so we don't waste a call on the wrong one; the other
  // is only tried as a fallback when there's no/!confident hint.
  async bridgeResolve(
    hash: string, chainId?: string, tsMs?: number, fast = false, prefer?: BridgeName,
  ): Promise<{ hop: OrbiterHop | null; outOfRange: boolean }> {
    const ctx = { chainId, tsMs, fast };
    try {
      // A known bridge (from the counterparty's address) is resolved EXCLUSIVELY
      // by its adapter — never probe the others. Without a hint (unlabelled
      // auto-trace) probe every adapter in parallel.
      return prefer ? await this.bridges.resolve(prefer, hash, ctx) : await this.bridges.resolveAny(hash, ctx);
    } catch (e) { this.logger.error(`bridgeResolve ${hash}: ${(e as Error)?.message}`); return { hop: null, outOfRange: false }; }
  }

  // Back-compat alias used by the existing resolve endpoint.
  orbiterResolve(hash: string, chainId?: string, tsMs?: number, fast = false, prefer?: BridgeName) {
    return this.bridgeResolve(hash, chainId, tsMs, fast, prefer);
  }

  async orbiterFeed(opts: {
    sourceChain: string; targetChain?: string; minUsd?: number; sinceMs?: number; untilMs?: number; limit?: number;
  }): Promise<{ hops: OrbiterHop[]; diag: string | null }> {
    try { return await this.orbiter.feed(opts); }
    catch (e) { return { hops: [], diag: String((e as Error)?.message || e) }; }
  }

  async debridgeFeed(opts: {
    sourceChain?: string; targetChain?: string; minUsd?: number; sinceMs?: number; limit?: number;
  }): Promise<{ hops: OrbiterHop[]; diag: string | null }> {
    try { return await this.debridge.feed(opts); }
    catch (e) { return { hops: [], diag: String((e as Error)?.message || e) }; }
  }

  async fetchTx(network: string, hash: string): Promise<TransferItem | null> {
    try {
      if (network === 'TRON') return await this.tron.fetchTx(hash);
      if (network === 'SOLANA') return await this.solana.fetchTx(hash);
      return await this.evm.fetchTx(network, hash);
    } catch (e) {
      this.logger.error(`fetchTx ${network} ${hash}: ${(e as Error)?.message}`);
      return null;
    }
  }

  async fetchAddressLabel(network: string, address: string): Promise<{ label: string | null; bridge?: string }> {
    // Known bridge makers/contracts win over the explorer's tag, so bridge
    // wallets are labelled even when the explorer has none — and we surface the
    // bridge id so the client can show the cross-chain button precisely.
    const known = await this.bridgeRegistry.forAddress(address);
    if (known) return { label: known.name, bridge: known.bridge };
    try {
      if (network === 'TRON') return await this.tron.fetchAddressLabel(address);
      if (network === 'SOLANA') return await this.solana.fetchAddressLabel(address);
      return await this.evm.fetchAddressLabel(network, address);
    } catch { return { label: null }; }
  }

  // On-chain holdings for a wallet: the native gas token + ERC-20/TRC-20/SPL
  // token balances, each priced in USD where a price is known. `totalUsd` sums
  // the priced holdings.
  async fetchBalance(
    network: string, address: string,
  ): Promise<{ holdings: { asset: string; amount: number; usdValue: number | null }[]; totalUsd: number | null; diag: string | null }> {
    try {
      const [native, tokens] = await Promise.all([
        network === 'TRON' ? this.tron.fetchBalance(address)
          : network === 'SOLANA' ? this.solana.fetchBalance(address)
          : this.evm.fetchBalance(network, address),
        network === 'TRON' ? this.tron.fetchTokenBalances(address)
          : network === 'SOLANA' ? this.solana.fetchTokenBalances(address)
          : this.evm.fetchTokenBalances(network, address),
      ]);

      const raw: { asset: string; amount: number }[] = [];
      if (native.amount != null) raw.push({ asset: native.asset, amount: native.amount });
      raw.push(...tokens);

      const prices = await this.price.pricesFor([...new Set(raw.map((h) => h.asset))]);
      let totalUsd: number | null = null;
      const holdings = raw.map((h) => {
        const p = prices.get(h.asset.toUpperCase());
        const usdValue = p != null ? h.amount * p : null;
        if (usdValue != null) totalUsd = (totalUsd ?? 0) + usdValue;
        return { asset: h.asset, amount: h.amount, usdValue };
      }).sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));

      return { holdings, totalUsd, diag: native.diag };
    } catch (e) {
      return { holdings: [], totalUsd: null, diag: String((e as Error)?.message || e) };
    }
  }

  async fetchWalletTransfers(
    network: string, address: string,
    opts: { native: boolean; token: boolean; limit: number; labels?: boolean },
  ): Promise<{ transfers: TransferItem[]; diag: string | null; status?: SourceStatus }> {
    const o = {
      native: opts.native ?? true,
      token: opts.token ?? true,
      // No hard 200 cap anymore — user can pull the wallet's full (recent) history.
      limit: Math.min(Math.max(Number(opts.limit) || 50, 1), MAX_TRANSFERS),
    };
    try {
      const started = Date.now();
      const res: { transfers: TransferItem[]; diag: string | null; status?: SourceStatus; source?: string } =
        network === 'TRON'
          ? await this.tron.fetchWalletTransfers(address, o)
          : network === 'SOLANA'
          ? await this.solana.fetchWalletTransfers(address, o)
          : await this.evm.fetchWalletTransfers(network, address, o);

      // Record the SOURCE's health (before our own value filtering) so a healthy
      // source with no ≥$1 transfers isn't mistaken for a failure. Providers that
      // don't report a status get one inferred from what they returned.
      const status: SourceStatus = res.status ?? (res.transfers.length ? 'ok' : res.diag ? 'down' : 'empty');
      this.health.record(res.source ?? network, status, { latencyMs: Date.now() - started, note: res.diag ?? undefined });

      const transfers = res.transfers
        .filter((t) => t.hash && (t.from || t.to))
        .filter((t) => { if (NATIVE_ASSETS.has(t.asset || '')) return true; return t.amount != null && !isNaN(t.amount) && t.amount >= 1; })
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, o.limit);

      await this.enrichUsd(transfers);
      if (opts.labels !== false) await this.enrichLabels(network, address, transfers);

      return { transfers, diag: transfers.length ? null : res.diag, status };
    } catch (e) {
      this.health.record(network, 'down', { note: String((e as Error)?.message || e) });
      return { transfers: [], diag: String((e as Error)?.message || e), status: 'down' };
    }
  }

  // Fill usdValue (where the provider didn't) from current token prices.
  private async enrichUsd(transfers: TransferItem[]): Promise<void> {
    const need = transfers.filter((t) => t.usdValue == null && t.amount != null && t.asset);
    if (!need.length) return;
    const prices = await this.price.pricesFor([...new Set(need.map((t) => t.asset as string))]);
    for (const t of need) {
      const p = prices.get((t.asset as string).toUpperCase());
      if (p != null) t.usdValue = (t.amount as number) * p;
    }
  }

  // ── Auto-trace "follow the money" ──────────────────────────────────────────
  // BFS over wallets along the value flow (default downstream/out). Expands each
  // counterparty unless it's a known entity (labelled → exchange/contract), below
  // the USD threshold, already visited, or past maxHops. Bridges are followed
  // cross-chain via the Orbiter indexer (fast mode). Returns a flat set of
  // transfers + bridge hops the frontend assembles into a subgraph.
  async traceFlow(opts: {
    network: string; address: string;
    direction?: 'out' | 'in'; maxHops?: number; minUsd?: number; perNode?: number;
  }): Promise<{ transfers: TransferItem[]; hops: OrbiterHop[]; terminals: string[]; stats: Record<string, number>; diag: string | null }> {
    const direction = opts.direction === 'in' ? 'in' : 'out';
    const maxHops = Math.min(Math.max(opts.maxHops ?? 3, 1), 5);
    const minUsd = Math.max(opts.minUsd ?? 50, 0);
    const perNode = Math.min(Math.max(opts.perNode ?? 25, 1), 50);
    const MAX_NODES = 120, MAX_EDGES = 800;
    let labelBudget = 80, bridgeBudget = 15;

    const labelCache = new Map<string, string | null>();
    const getLabel = async (net: string, addr: string): Promise<string | null> => {
      const k = addr.toLowerCase();
      if (labelCache.has(k)) return labelCache.get(k)!;
      if (labelBudget-- <= 0) return null;
      let label: string | null = null;
      try { label = (await this.fetchAddressLabel(net, addr)).label; } catch { /* ignore */ }
      labelCache.set(k, label);
      return label;
    };

    const transfers: TransferItem[] = [];
    const hops: OrbiterHop[] = [];
    const terminals = new Set<string>();
    const seen = new Set<string>([walletKey(opts.network, opts.address)]);
    let nodeCount = 1;
    let frontier: Array<{ net: string; addr: string }> = [{ net: opts.network, addr: opts.address }];

    for (let depth = 0; depth < maxHops && frontier.length && nodeCount < MAX_NODES && transfers.length < MAX_EDGES; depth++) {
      const next: Array<{ net: string; addr: string }> = [];
      for (const node of frontier) {
        let res: { transfers: TransferItem[] };
        try { res = await this.fetchWalletTransfers(node.net, node.addr, { native: true, token: true, limit: perNode, labels: false }); }
        catch { continue; }

        const me = node.addr.toLowerCase();
        const mine = res.transfers
          .filter((t) => { const a = direction === 'out' ? t.from : t.to; return a && a.toLowerCase() === me; })
          .filter((t) => (t.usdValue ?? 0) >= minUsd)
          .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));

        const enqueueTarget = (hop: OrbiterHop) => {
          const tw = hop.targetWallet;
          if (tw && TRACE_SUPPORTED.has(hop.targetNet)) {
            const k = walletKey(hop.targetNet, tw);
            if (!seen.has(k) && nodeCount < MAX_NODES) { seen.add(k); nodeCount++; next.push({ net: hop.targetNet, addr: tw }); }
          }
        };

        let bridgeChecks = 0;
        for (const t of mine) {
          if (transfers.length >= MAX_EDGES) break;
          const cp = direction === 'out' ? t.to : t.from;
          if (!cp) continue;

          const label = await getLabel(node.net, cp);
          if (label) { if (direction === 'out') t.toLabel = label; else t.fromLabel = label; }
          transfers.push(t);

          // 1) Counterparty is a KNOWN bridge (from the address registry) with a
          //    resolver → follow ONLY that bridge cross-chain instead of stopping.
          const knownBridge = (await this.bridgeRegistry.forAddress(cp))?.bridge;
          if (knownBridge && this.bridges.has(knownBridge)) {
            if (bridgeBudget > 0) {
              bridgeBudget--;
              const { hop } = await this.bridgeResolve(t.hash, undefined, t.timestamp, true, knownBridge);
              if (hop) { hops.push(hop); enqueueTarget(hop); }
            }
            continue; // it's a bridge maker — don't expand it as a wallet
          }

          // 2) Any other labelled entity (exchange/contract/detection-only bridge)
          //    → terminal, stop here.
          if (label) { terminals.add(cp); continue; }

          // 3) Unlabelled → bounded probe of ALL bridge adapters (top transfers).
          if (bridgeBudget > 0 && bridgeChecks < 2) {
            bridgeChecks++; bridgeBudget--;
            const { hop } = await this.bridgeResolve(t.hash, undefined, t.timestamp, true);
            if (hop) { hops.push(hop); enqueueTarget(hop); continue; }
          }

          // 4) Plain wallet → expand next hop.
          const k = walletKey(node.net, cp);
          if (seen.has(k)) continue;
          seen.add(k);
          if (nodeCount < MAX_NODES) { nodeCount++; next.push({ net: node.net, addr: cp }); }
        }
      }
      frontier = next;
    }

    return {
      transfers, hops, terminals: [...terminals],
      stats: { nodes: nodeCount, edges: transfers.length, bridges: hops.length, terminals: terminals.size, hops: maxHops },
      diag: transfers.length ? null : 'Поток не прослежен — нет переводов выше порога (попробуйте снизить мин. $).',
    };
  }

  // Attach entity tags (exchange/contract names) to counterparty addresses so the
  // user spots interesting transfers. Bounded: unique counterparties, capped.
  private async enrichLabels(network: string, wallet: string, transfers: TransferItem[]): Promise<void> {
    const self = wallet.toLowerCase();
    const counterparties = new Set<string>();
    for (const t of transfers) {
      for (const a of [t.from, t.to]) {
        if (a && a.toLowerCase() !== self) counterparties.add(a);
      }
      if (counterparties.size >= MAX_LABELS) break;
    }
    if (!counterparties.size) return;

    const labels = new Map<string, string | null>();
    await Promise.all([...counterparties].slice(0, MAX_LABELS).map(async (addr) => {
      try { labels.set(addr, (await this.fetchAddressLabel(network, addr)).label); }
      catch { labels.set(addr, null); }
    }));
    for (const t of transfers) {
      if (t.from && labels.get(t.from)) t.fromLabel = labels.get(t.from)!;
      if (t.to && labels.get(t.to)) t.toLabel = labels.get(t.to)!;
    }
  }
}
