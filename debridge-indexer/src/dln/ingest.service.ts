import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from './orders.service';
import { DlnClient, sv } from './dln.client';

@Injectable()
export class IngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestService.name);
  private timers: NodeJS.Timeout[] = [];
  private crawling = false;
  private enriching = false;

  constructor(
    private readonly cfg: ConfigService,
    private readonly client: DlnClient,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit() {
    const num = (k: string, d: number) => Number(this.cfg.get(k, d));
    if (this.cfg.get('CRAWL_ENABLED', 'true') !== 'false') {
      const ms = num('CRAWL_INTERVAL_MS', 120000);
      this.timers.push(setInterval(() => void this.safeCrawl(), ms));
      void this.safeCrawl();
      this.logger.log(`Forward crawler enabled (every ${ms}ms)`);
    }
    if (this.cfg.get('ENRICH_ENABLED', 'true') !== 'false') {
      const ms = num('ENRICH_INTERVAL_MS', 45000);
      this.timers.push(setInterval(() => void this.safeEnrich(), ms));
      this.logger.log(`Enrichment enabled (every ${ms}ms)`);
    }
  }

  onModuleDestroy() { this.timers.forEach(clearInterval); }

  private async safeCrawl() {
    if (this.crawling) return;
    this.crawling = true;
    try { await this.crawlForward(); } catch (e) { this.logger.error(`crawl: ${(e as Error).message}`); }
    finally { this.crawling = false; }
  }
  private async safeEnrich() {
    if (this.enriching) return;
    this.enriching = true;
    try { await this.enrichOnce(Number(this.cfg.get('ENRICH_BATCH', 40))); }
    catch (e) { this.logger.error(`enrich: ${(e as Error).message}`); }
    finally { this.enriching = false; }
  }

  // Page the newest orders (skip) and store new ones until we catch up
  // (two consecutive pages with nothing new) or hit the page cap.
  async crawlForward(maxPages = 50): Promise<number> {
    let added = 0, emptyStreak = 0;
    for (let page = 0; page < maxPages; page++) {
      const orders = await this.client.list(page * 100, 100);
      if (!orders.length) break;
      const n = await this.orders.upsertMany(orders.map((o) => this.orders.toEntity(o)).filter((e): e is NonNullable<typeof e> => !!e));
      added += n;
      if (n === 0) { if (++emptyStreak >= 2) break; } else emptyStreak = 0;
    }
    if (added) this.logger.log(`Forward crawl: +${added} new orders`);
    return added;
  }

  // Deep backfill (skip-paginate) up to maxOrders, optional chain filter.
  async backfill(opts: { giveChain?: string; takeChain?: string; maxOrders?: number }): Promise<number> {
    const maxOrders = opts.maxOrders ?? 5000;
    let added = 0, fetched = 0;
    for (let page = 0; fetched < maxOrders; page++) {
      const orders = await this.client.list(page * 100, 100, opts.giveChain, opts.takeChain);
      if (!orders.length) break;
      fetched += orders.length;
      added += await this.orders.upsertMany(orders.map((o) => this.orders.toEntity(o)).filter((e): e is NonNullable<typeof e> => !!e));
      if (orders.length < 100) break;
    }
    this.logger.log(`Backfill ${opts.giveChain ?? '*'}→${opts.takeChain ?? '*'}: fetched ${fetched}, +${added} new`);
    return added;
  }

  // Fill sender/receiver + dest tx via the order-detail endpoint.
  async enrichOnce(batch: number): Promise<number> {
    const rows = await this.orders.unenriched(batch);
    if (!rows.length) return 0;
    let filled = 0;
    const pool = 6;
    for (let i = 0; i < rows.length; i += pool) {
      await Promise.all(rows.slice(i, i + pool).map(async (r) => {
        const detail = await this.client.detail(r.orderId);
        if (detail && (sv(detail.makerSrc) || detail.fulfilledDstEventMetadata)) {
          await this.orders.applyDetail(r.orderId, detail); filled++;
        } else {
          await this.orders.markEnriched(r.orderId); // nothing more available — stop retrying
        }
      }));
    }
    if (filled) this.logger.log(`Enriched ${filled}/${rows.length} orders`);
    return filled;
  }
}
