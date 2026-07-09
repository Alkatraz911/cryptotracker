import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DebridgeOrder } from './entities/debridge-order.entity';
import { DlnClient, DlnOrder, DLN_CHAINS, sv } from './dln.client';

const lc = (s?: string | null) => (s ? s.toLowerCase() : null);

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(DebridgeOrder) private readonly repo: Repository<DebridgeOrder>,
  ) {}

  // Base entity from a list order (no addresses / dest tx yet → enrich later).
  toEntity(o: DlnOrder): DebridgeOrder | null {
    const orderId = sv(o.orderId);
    const giveChain = sv(o.giveOfferWithMetadata?.chainId);
    const takeChain = sv(o.takeOfferWithMetadata?.chainId);
    if (!orderId || !giveChain || !takeChain) return null;
    const e = new DebridgeOrder();
    e.orderId = orderId.toLowerCase();
    e.srcTx = lc(sv(o.createdSrcEventMetadata?.transactionHash) ?? sv(o.createEventTransactionHash));
    e.dstTx = lc(sv(o.fulfilledDstEventMetadata?.transactionHash));
    e.giveChain = giveChain;
    e.takeChain = takeChain;
    e.giveChainName = DLN_CHAINS[giveChain]?.name ?? null;
    e.takeChainName = DLN_CHAINS[takeChain]?.name ?? null;
    e.giveNet = DLN_CHAINS[giveChain]?.net ?? 'UNKNOWN';
    e.takeNet = DLN_CHAINS[takeChain]?.net ?? 'UNKNOWN';
    e.sender = lc(sv(o.makerSrc));
    e.receiver = lc(sv(o.receiverDst));
    e.giveAmount = DlnClient.amount(o.giveOfferWithMetadata);
    e.giveSymbol = o.giveOfferWithMetadata?.symbol ?? null;
    e.takeAmount = DlnClient.amount(o.takeOfferWithMetadata);
    e.takeSymbol = o.takeOfferWithMetadata?.symbol ?? null;
    e.state = o.state ?? null;
    e.creationTime = new Date((o.createdSrcEventMetadata?.blockTimeStamp ?? o.creationTimestamp ?? 0) * 1000);
    e.enriched = !!(e.sender && e.dstTx); // list rarely has these → usually false
    return e;
  }

  async upsertMany(rows: DebridgeOrder[]): Promise<number> {
    if (!rows.length) return 0;
    const byId = new Map(rows.map((r) => [r.orderId, r]));
    const ids = [...byId.keys()];
    const existing = await this.repo.find({ where: { orderId: In(ids) }, select: { orderId: true } });
    const have = new Set(existing.map((e) => e.orderId));
    const fresh = ids.filter((id) => !have.has(id)).map((id) => byId.get(id)!);
    if (fresh.length) await this.repo.insert(fresh);
    return fresh.length;
  }

  // Apply order-detail enrichment (addresses + dest tx + state).
  async applyDetail(orderId: string, o: DlnOrder): Promise<void> {
    await this.repo.update({ orderId: orderId.toLowerCase() }, {
      sender: lc(sv(o.makerSrc)),
      receiver: lc(sv(o.receiverDst)),
      dstTx: lc(sv(o.fulfilledDstEventMetadata?.transactionHash)),
      state: o.state ?? null,
      enriched: true,
    });
  }

  async markEnriched(orderId: string): Promise<void> {
    await this.repo.update({ orderId: orderId.toLowerCase() }, { enriched: true });
  }

  unenriched(limit: number): Promise<DebridgeOrder[]> {
    return this.repo.find({ where: { enriched: false }, order: { creationTime: 'DESC' }, take: limit });
  }

  // ── queries ────────────────────────────────────────────────────────────────
  byHash(hash: string): Promise<DebridgeOrder | null> {
    const h = hash.toLowerCase();
    return this.repo.findOne({ where: [{ srcTx: h }, { dstTx: h }, { orderId: h }] });
  }

  byAddress(address: string, limit = 100): Promise<DebridgeOrder[]> {
    const a = address.toLowerCase();
    return this.repo.find({
      where: [{ sender: a }, { receiver: a }],
      order: { creationTime: 'DESC' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
  }

  search(f: { giveChain?: string; takeChain?: string; sinceMs?: number; untilMs?: number; limit?: number }): Promise<DebridgeOrder[]> {
    const qb = this.repo.createQueryBuilder('o');
    if (f.giveChain) qb.andWhere('o.give_chain = :gc', { gc: f.giveChain });
    if (f.takeChain) qb.andWhere('o.take_chain = :tc', { tc: f.takeChain });
    if (f.sinceMs) qb.andWhere('o.creation_time >= :s', { s: new Date(f.sinceMs) });
    if (f.untilMs) qb.andWhere('o.creation_time <= :e', { e: new Date(f.untilMs) });
    return qb.orderBy('o.creation_time', 'DESC').take(Math.min(Math.max(f.limit ?? 100, 1), 1000)).getMany();
  }

  async stats(): Promise<{ total: number; enriched: number; oldest: string | null; newest: string | null }> {
    const total = await this.repo.count();
    const enriched = await this.repo.count({ where: { enriched: true } });
    const oldest = await this.repo.findOne({ where: {}, order: { creationTime: 'ASC' } });
    const newest = await this.repo.findOne({ where: {}, order: { creationTime: 'DESC' } });
    return { total, enriched, oldest: oldest?.creationTime.toISOString() ?? null, newest: newest?.creationTime.toISOString() ?? null };
  }

  async reclassify(): Promise<number> {
    let touched = 0;
    for (const [id, c] of Object.entries(DLN_CHAINS)) {
      const g = await this.repo.update({ giveChain: id }, { giveChainName: c.name, giveNet: c.net });
      const t = await this.repo.update({ takeChain: id }, { takeChainName: c.name, takeNet: c.net });
      touched += (g.affected ?? 0) + (t.affected ?? 0);
    }
    return touched;
  }
}
