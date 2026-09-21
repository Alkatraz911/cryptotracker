import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AddressLabel, LabelSource } from './entities/address-label.entity';

// Sources a person typed/copied — they win over explorer-captured tags.
const HUMAN_SOURCES = new Set<LabelSource>(['manual', 'okx']);

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

  // Explorer-captured tag: fills a gap, never replaces a human entry. Fire-and-
  // forget — a label lookup must not fail because the registry write did.
  remember(address: string, label: string, source: LabelSource): void {
    const key = labelKey(address);
    if (!key || !label.trim()) return;
    void (async () => {
      const cur = (await this.map()).get(key);
      if (cur && (HUMAN_SOURCES.has(cur.source) || cur.label === label.trim())) return;
      await this.repo.upsert({ address: key, label: label.trim(), source, createdBy: null }, ['address']);
      this.cache = null;
    })().catch((e) => this.logger.warn(`remember ${key}: ${(e as Error)?.message}`));
  }

  async remove(address: string): Promise<void> {
    await this.repo.delete({ address: labelKey(address) });
    this.cache = null;
  }
}
