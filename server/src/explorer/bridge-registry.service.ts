import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BridgeAddress } from './entities/bridge-address.entity';
import type { BridgeName } from './explorer.service';

export interface BridgeEntry {
  bridge: BridgeName;
  name: string;
}

// DB-backed registry of known bridge maker/contract addresses. The full table is
// small, so it's cached in memory with a short TTL — direct DB inserts are picked
// up within the TTL, and writes through this service invalidate immediately.
@Injectable()
export class BridgeRegistryService {
  private cache: Map<string, BridgeEntry> | null = null;
  private loadedAt = 0;
  private static readonly TTL = 60_000;

  constructor(@InjectRepository(BridgeAddress) private readonly repo: Repository<BridgeAddress>) {}

  private async map(): Promise<Map<string, BridgeEntry>> {
    if (this.cache && Date.now() - this.loadedAt < BridgeRegistryService.TTL) return this.cache;
    const rows = await this.repo.find();
    this.cache = new Map(rows.map((r) => [r.address.toLowerCase(), { bridge: r.bridge as BridgeName, name: r.name }]));
    this.loadedAt = Date.now();
    return this.cache;
  }

  async forAddress(address?: string | null): Promise<BridgeEntry | undefined> {
    if (!address) return undefined;
    return (await this.map()).get(address.toLowerCase());
  }

  list(): Promise<BridgeAddress[]> {
    return this.repo.find({ order: { bridge: 'ASC', name: 'ASC' } });
  }

  async add(entry: { address: string; bridge: BridgeName; name: string }): Promise<BridgeAddress> {
    const row = { address: entry.address.toLowerCase(), bridge: entry.bridge, name: entry.name };
    await this.repo.upsert(row, ['address']);
    this.cache = null; // invalidate so the new entry is effective immediately
    return (await this.repo.findOneByOrFail({ address: row.address }));
  }

  async remove(address: string): Promise<void> {
    await this.repo.delete({ address: address.toLowerCase() });
    this.cache = null;
  }
}
