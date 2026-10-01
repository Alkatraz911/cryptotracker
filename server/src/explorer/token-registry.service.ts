import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TransferItem } from './providers/evm.provider';
import { TokenContract, TokenStatus } from './entities/token-contract.entity';
import { classifyToken } from './token-classifier';

const PLATFORMS: Record<string, string> = {
  SOLANA: 'solana', ETH: 'ethereum', BSC: 'binance-smart-chain', POLYGON: 'polygon-pos',
  ARBITRUM: 'arbitrum-one', BASE: 'base', TRON: 'tron',
};
const NATIVE: Record<string, string> = {
  SOLANA: 'SOL', ETH: 'ETH', BSC: 'BNB', POLYGON: 'POL', ARBITRUM: 'ETH', BASE: 'ETH', TRON: 'TRX',
};
const MAJORS = new Set(['USDT', 'USDC', 'DAI', 'WETH', 'WBTC', 'ETH', 'BNB', 'TRX', 'SOL', 'BUSD', 'FDUSD', 'TUSD', 'USDD', 'PYUSD']);
const ADDRESS: Record<string, RegExp> = {
  SOLANA: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, TRON: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
};
export const tokenKey = (network: string, contract: string) => `${network.toUpperCase()}:${contract.startsWith('0x') ? contract.toLowerCase() : contract}`;

@Injectable()
export class TokenRegistryService {
  private readonly logger = new Logger(TokenRegistryService.name);
  private cache: Map<string, TokenContract> | null = null;
  private loadedAt = 0;
  private gecko: Map<string, { id: string; symbol: string; name: string }> | null = null;
  private geckoAt = 0;
  private geckoRetryAt = 0;
  private geckoLoading: Promise<Map<string, { id: string; symbol: string; name: string }> | null> | null = null;

  constructor(@InjectRepository(TokenContract) private readonly repo: Repository<TokenContract>) {}

  private async map() {
    if (this.cache && Date.now() - this.loadedAt < 60_000) return this.cache;
    const rows = await this.repo.find();
    this.cache = new Map(rows.map((r) => [tokenKey(r.network, r.contract), r]));
    this.loadedAt = Date.now();
    return this.cache;
  }

  private async coinGecko() {
    if (this.gecko && Date.now() - this.geckoAt < 86_400_000) return this.gecko;
    if (Date.now() < this.geckoRetryAt) return this.gecko;
    if (this.geckoLoading) return this.geckoLoading;
    this.geckoLoading = (async () => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 15000);
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/coins/list?include_platform=true', { signal: ac.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const coins = await response.json() as Array<{ id: string; symbol: string; name: string; platforms?: Record<string, string> }>;
        const result = new Map<string, { id: string; symbol: string; name: string }>();
        for (const coin of coins) for (const [network, platform] of Object.entries(PLATFORMS)) {
          const contract = coin.platforms?.[platform];
          if (contract) result.set(tokenKey(network, contract), { id: coin.id, symbol: coin.symbol.toUpperCase(), name: coin.name });
        }
        this.gecko = result;
        this.geckoAt = Date.now();
        return result;
      } catch (e) {
        this.logger.warn(`CoinGecko list: ${(e as Error).message}`);
        this.geckoRetryAt = Date.now() + 5 * 60_000;
        return this.gecko;
      } finally { clearTimeout(timer); this.geckoLoading = null; }
    })();
    return this.geckoLoading;
  }

  async observe(transfers: TransferItem[]): Promise<void> {
    const seen = new Map<string, TransferItem>();
    for (const t of transfers) if (t.contract) seen.set(tokenKey(t.network, t.contract), t);
    if (!seen.size) return;
    const map = await this.map();
    const needsClassify = [...seen].filter(([key]) => !map.has(key));
    const gecko = needsClassify.length ? await this.coinGecko() : null;
    const trusted = [...map.values()].filter((r) => r.status === 'trusted');
    if (gecko) for (const [key, coin] of gecko) {
      if (MAJORS.has(coin.symbol.toUpperCase())) trusted.push({ network: key.slice(0, key.indexOf(':')), contract: key.slice(key.indexOf(':') + 1), symbol: coin.symbol } as TokenContract);
    }
    for (const [key, t] of seen) {
      const contract = key.slice(key.indexOf(':') + 1);
      const old = map.get(key);
      if (old) {
        await this.repo.increment({ network: t.network, contract }, 'seenCount', 1);
        await this.repo.update({ network: t.network, contract }, { lastSeen: new Date(), symbol: old.symbol === 'SPL' ? this.gecko?.get(key)?.symbol || t.asset || old.symbol : old.symbol || t.asset || null, name: old.name || t.tokenName || null });
        continue;
      }
      const match = gecko?.get(key);
      const result = classifyToken({ network: t.network, contract, symbol: t.asset, name: t.tokenName, coingeckoId: match?.id }, trusted);
      const row = this.repo.create({ network: t.network, contract, symbol: t.asset && t.asset !== 'SPL' ? t.asset : match?.symbol || t.asset || null,
        name: t.tokenName || match?.name || null, decimals: null, status: result.status, source: result.source,
        reason: result.reason, coingeckoId: match?.id || null, seenCount: 1, firstSeen: new Date(), lastSeen: new Date(), updatedBy: null, updatedAt: new Date() });
      // Concurrent requests can see the same new contract. Never overwrite an admin decision.
      await this.repo.createQueryBuilder().insert().into(TokenContract).values(row).orIgnore().execute();
      map.set(key, (await this.repo.findOneBy({ network: t.network, contract })) ?? row);
      if (result.status === 'trusted') trusted.push(row);
    }
    this.cache = null;
  }

  async annotate(transfers: TransferItem[]): Promise<TransferItem[]> {
    const map = await this.map();
    for (const t of transfers) {
      const native = !t.contract && NATIVE[t.network] === t.asset;
      const row = t.contract ? map.get(tokenKey(t.network, t.contract)) : null;
      t.tokenStatus = native ? 'trusted' : row?.status ?? 'unknown';
      t.tokenReason = row?.reason ?? null;
      if (row?.name && !t.tokenName) t.tokenName = row.name;
    }
    return transfers;
  }

  async list(network?: string, status?: TokenStatus, q?: string): Promise<TokenContract[]> {
    const qb = this.repo.createQueryBuilder('t');
    if (network) qb.andWhere('t.network = :network', { network: network.toUpperCase() });
    if (status) qb.andWhere('t.status = :status', { status });
    if (q) qb.andWhere('(LOWER(t.symbol) LIKE :q OR LOWER(t.name) LIKE :q OR LOWER(t.contract) LIKE :q)', { q: `%${q.toLowerCase()}%` });
    return qb.orderBy('t.lastSeen', 'DESC').take(1000).getMany();
  }

  async setStatus(input: { network: string; contract: string; status: TokenStatus; reason?: string }, by: string): Promise<TokenContract> {
    const network = input.network.toUpperCase();
    const contract = input.contract.startsWith('0x') ? input.contract.toLowerCase() : input.contract;
    if (!PLATFORMS[network] || !(ADDRESS[network] ?? /^0x[0-9a-f]{40}$/).test(contract)) throw new BadRequestException('Invalid network or contract');
    const current = await this.repo.findOneBy({ network, contract });
    const row = this.repo.create({ ...current, network, contract, symbol: current?.symbol ?? null, name: current?.name ?? null,
      decimals: current?.decimals ?? null, status: input.status, source: 'admin', reason: input.reason?.trim() || null,
      coingeckoId: current?.coingeckoId ?? null, seenCount: current?.seenCount ?? 0,
      firstSeen: current?.firstSeen ?? new Date(), lastSeen: current?.lastSeen ?? new Date(), updatedBy: by, updatedAt: new Date() });
    await this.repo.save(row);
    this.cache = null;
    return row;
  }

  async setMany(entries: Array<{ network: string; contract: string; status: TokenStatus; reason?: string }>, by: string): Promise<number> {
    for (const entry of entries) await this.setStatus(entry, by);
    return entries.length;
  }
}
