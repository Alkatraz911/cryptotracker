import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OrbiterBridge } from './entities/orbiter-bridge.entity';
import { OrbiterRow, OrbiterLookup, ORBITER_CHAINS } from './orbiter.client';

const lc = (s?: string | null) => (s ? s.toLowerCase() : null);

@Injectable()
export class BridgesService {
  private readonly logger = new Logger(BridgesService.name);

  constructor(
    @InjectRepository(OrbiterBridge) private readonly repo: Repository<OrbiterBridge>,
  ) {}

  // Map a raw feed row to an entity (no addresses — those come from enrichment).
  rowToEntity(r: OrbiterRow): OrbiterBridge {
    const e = new OrbiterBridge();
    e.sourceId = r.sourceId.toLowerCase();
    e.targetId = lc(r.targetId);
    e.sourceChain = r.sourceChain;
    e.targetChain = r.targetChain;
    const s = ORBITER_CHAINS[r.sourceChain];
    const t = ORBITER_CHAINS[r.targetChain];
    e.sourceChainName = s?.name ?? null;
    e.targetChainName = t?.name ?? null;
    e.sourceNet = s?.net ?? 'UNKNOWN';
    e.targetNet = t?.net ?? 'UNKNOWN';
    e.amount = Number(r.sourceAmount) || null;
    e.symbol = r.sourceSymbol ?? null;
    e.usd = Number(r.sourceAmountUSD) || null;
    e.sourceTime = new Date(r.sourceTime);
    e.enriched = false;
    e.sender = null; e.receiver = null; e.targetAddress = null;
    return e;
  }

  // Insert rows that don't already exist (keyed by source_id). Returns new count.
  async upsertMany(rows: OrbiterBridge[]): Promise<number> {
    if (!rows.length) return 0;
    // de-dup within the batch
    const byId = new Map(rows.map((r) => [r.sourceId, r]));
    const ids = [...byId.keys()];
    const existing = await this.repo.find({ where: { sourceId: In(ids) }, select: { sourceId: true } });
    const have = new Set(existing.map((e) => e.sourceId));
    const fresh = ids.filter((id) => !have.has(id)).map((id) => byId.get(id)!);
    if (fresh.length) await this.repo.insert(fresh);
    return fresh.length;
  }

  // Apply lookup-endpoint addresses to an existing row.
  async applyLookup(sourceId: string, l: OrbiterLookup): Promise<void> {
    await this.repo.update({ sourceId: sourceId.toLowerCase() }, {
      sender: lc(l.sender), receiver: lc(l.receiver), targetAddress: lc(l.targetAddress),
      targetId: lc(l.targetId), enriched: true,
    });
  }

  async markEnriched(sourceId: string): Promise<void> {
    await this.repo.update({ sourceId: sourceId.toLowerCase() }, { enriched: true });
  }

  // Backfill chain name/net classifiers on rows that predate this column
  // (or were ingested before the registry knew a chain). Returns rows touched.
  async reclassify(): Promise<number> {
    let touched = 0;
    for (const [id, c] of Object.entries(ORBITER_CHAINS)) {
      const s = await this.repo.update({ sourceChain: id }, { sourceChainName: c.name, sourceNet: c.net });
      const t = await this.repo.update({ targetChain: id }, { targetChainName: c.name, targetNet: c.net });
      touched += (s.affected ?? 0) + (t.affected ?? 0);
    }
    return touched;
  }

  // Rows still needing address enrichment (most recent first — within lookup range).
  unenriched(limit: number): Promise<OrbiterBridge[]> {
    return this.repo.find({ where: { enriched: false }, order: { sourceTime: 'DESC' }, take: limit });
  }

  // ── queries ────────────────────────────────────────────────────────────────
  byHash(hash: string): Promise<OrbiterBridge | null> {
    const h = hash.toLowerCase();
    return this.repo.findOne({ where: [{ sourceId: h }, { targetId: h }] });
  }

  byAddress(address: string, limit = 100): Promise<OrbiterBridge[]> {
    const a = address.toLowerCase();
    return this.repo.find({
      where: [{ sender: a }, { receiver: a }, { targetAddress: a }],
      order: { sourceTime: 'DESC' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
  }

  search(f: {
    sourceChain?: string; targetChain?: string; minUsd?: number;
    sinceMs?: number; untilMs?: number; limit?: number;
  }): Promise<OrbiterBridge[]> {
    const qb = this.repo.createQueryBuilder('b');
    if (f.sourceChain) qb.andWhere('b.source_chain = :sc', { sc: f.sourceChain });
    if (f.targetChain) qb.andWhere('b.target_chain = :tc', { tc: f.targetChain });
    if (f.minUsd) qb.andWhere('b.usd >= :u', { u: f.minUsd });
    if (f.sinceMs) qb.andWhere('b.source_time >= :s', { s: new Date(f.sinceMs) });
    if (f.untilMs) qb.andWhere('b.source_time <= :e', { e: new Date(f.untilMs) });
    return qb.orderBy('b.source_time', 'DESC')
      .take(Math.min(Math.max(f.limit ?? 100, 1), 1000))
      .getMany();
  }

  async stats(): Promise<{ total: number; enriched: number; oldest: string | null; newest: string | null }> {
    const total = await this.repo.count();
    const enriched = await this.repo.count({ where: { enriched: true } });
    const oldest = await this.repo.findOne({ where: {}, order: { sourceTime: 'ASC' } });
    const newest = await this.repo.findOne({ where: {}, order: { sourceTime: 'DESC' } });
    return {
      total, enriched,
      oldest: oldest?.sourceTime.toISOString() ?? null,
      newest: newest?.sourceTime.toISOString() ?? null,
    };
  }
}
