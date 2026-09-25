import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AddressLabel, LabelSource } from './entities/address-label.entity';

// Who to believe when sources disagree: what a person typed or OKX showed
// them, then a chain explorer's tag. A source only replaces one of lower
// rank — never a peer or a better one.
const RANK: Record<string, number> = { manual: 3, okx: 3 };
export const sourceRank = (s: LabelSource): number => RANK[s] ?? 1;

// EVM addresses are chain-agnostic and case-insensitive; TRON/Solana are not.
export const labelKey = (address: string): string =>
  /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : address.trim();

// DB-backed address → entity label registry shared by every user/project. Read
// on every label lookup, so the (small) table is cached in memory with a short
// TTL; writes through this service invalidate immediately.
@Injectable()
export class LabelRegistryService {
  private readonly logger = new Logger(LabelRegistryService.name);
  private cache: Map<string, AddressLabel> | null = null;
  private loadedAt = 0;
  private static readonly TTL = 60_000;

  constructor(@InjectRepository(AddressLabel) private readonly repo: Repository<AddressLabel>) {}

  private async map(): Promise<Map<string, AddressLabel>> {
    if (this.cache && Date.now() - this.loadedAt < LabelRegistryService.TTL) return this.cache;
    const rows = await this.repo.find();
    this.cache = new Map(rows.map((r) => [r.address, r]));
    this.loadedAt = Date.now();
    return this.cache;
  }

  async forAddress(address?: string | null): Promise<AddressLabel | undefined> {
    if (!address) return undefined;
    return (await this.map()).get(labelKey(address));
  }

  list(): Promise<AddressLabel[]> {
    return this.repo.find({ order: { updatedAt: 'DESC' } });
  }

  // Human entry: always wins (overwrites whatever is there).
  async set(entry: { address: string; label: string; source?: LabelSource; by?: string | null }): Promise<AddressLabel> {
    const row = {
      address: labelKey(entry.address),
      label: entry.label.trim(),
      source: entry.source ?? 'manual',
      createdBy: entry.by ?? null,
    };
    await this.repo.upsert(row, ['address']);
    this.cache = null;
    return this.repo.findOneByOrFail({ address: row.address });
  }

  async setMany(entries: Array<{ address: string; label: string; source?: LabelSource }>, by: string | null): Promise<number> {
    const rows = entries
      .map((e) => ({ address: labelKey(e.address), label: e.label.trim(), source: e.source ?? 'manual', createdBy: by }))
      .filter((r) => r.address && r.label);
    if (!rows.length) return 0;
    await this.repo.upsert(rows, ['address']);
    this.cache = null;
    return rows.length;
  }

  // Registry entries for a batch of addresses (keys as the caller sent them).
  async forAddresses(addresses: string[]): Promise<Record<string, { label: string; source: LabelSource }>> {
    const m = await this.map();
    const out: Record<string, { label: string; source: LabelSource }> = {};
    for (const a of addresses) {
      const r = m.get(labelKey(a));
      if (r) out[a] = { label: r.label, source: r.source };
    }
    return out;
  }

  // Tags the OKX userscript harvested: newer OKX data replaces older OKX data
  // and explorer tags, but never a label a person typed in the app.
  async learn(entries: Array<{ address: string; label: string }>, source: LabelSource, by: string | null): Promise<string[]> {
    const m = await this.map();
    const rows = entries
      .map((e) => ({ address: labelKey(e.address), label: e.label.trim(), source, createdBy: by }))
      .filter((r) => r.address && r.label && m.get(r.address)?.source !== 'manual');
    if (!rows.length) return [];
    await this.repo.upsert(rows, ['address']);
    this.cache = null;
    return rows.map((r) => r.address);
  }

  // Auto-captured label (explorer tag): fills a gap or upgrades a
  // lower-ranked entry, never touches a human one. Fire-and-forget — a label
  // lookup must not fail because the registry write did.
  remember(address: string, label: string, source: LabelSource): void {
    const key = labelKey(address);
    if (!key || !label.trim()) return;
    void (async () => {
      const cur = (await this.map()).get(key);
      if (cur && (sourceRank(cur.source) >= sourceRank(source) || cur.label === label.trim())) return;
      await this.repo.upsert({ address: key, label: label.trim(), source, createdBy: null }, ['address']);
      this.cache = null;
    })().catch((e) => this.logger.warn(`remember ${key}: ${(e as Error)?.message}`));
  }

  async remove(address: string): Promise<void> {
    await this.repo.delete({ address: labelKey(address) });
    this.cache = null;
  }
}
