import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BridgesService } from './bridges.service';
import { OrbiterClient, ORBITER_CHAIN_IDS } from './orbiter.client';

@Injectable()
export class IngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestService.name);
  private timers: NodeJS.Timeout[] = [];
  private crawling = false;
  private enriching = false;

  constructor(
    private readonly cfg: ConfigService,
    private readonly client: OrbiterClient,
    private readonly bridges: BridgesService,
  ) {}

  onModuleInit() {
    const num = (k: string, d: number) => Number(this.cfg.get(k, d));
    if (this.cfg.get('CRAWL_ENABLED', 'true') !== 'false') {
      const ms = num('CRAWL_INTERVAL_MS', 180000);
      this.timers.push(setInterval(() => void this.safeCrawl(), ms));
      void this.safeCrawl(); // run once on boot
      this.logger.log(`Forward crawler enabled (every ${ms}ms)`);
    }
    if (this.cfg.get('ENRICH_ENABLED', 'true') !== 'false') {
      const ms = num('ENRICH_INTERVAL_MS', 60000);
      this.timers.push(setInterval(() => void this.safeEnrich(), ms));
      this.logger.log(`Address enrichment enabled (every ${ms}ms)`);
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

  // Poll the global feed from page 1 and store new rows until we catch up
  // (two consecutive pages with nothing new) or hit the page cap.
  async crawlForward(maxPages = 60): Promise<number> {
    let newTotal = 0;
    let emptyStreak = 0;
    for (let page = 1; page <= maxPages; page++) {
      const rows = await this.client.fetchPage({ page });
      if (!rows.length) break;
      const added = await this.bridges.upsertMany(rows.map((r) => this.bridges.rowToEntity(r)));
      newTotal += added;
      if (added === 0) { if (++emptyStreak >= 2) break; } else emptyStreak = 0;
    }
    if (newTotal) this.logger.log(`Forward crawl: +${newTotal} new bridges`);
    return newTotal;
  }

  // Deep backfill of a chain (optionally a specific target) over a time window.
  async backfill(opts: {
    sourceChain: string; targetChain?: string; sinceMs: number; untilMs: number; maxRows?: number;
  }): Promise<{ added: number; fetched: number; outOfRange: boolean }> {
    const { rows, outOfRange } = await this.client.collectWindow({
      sourceChain: opts.sourceChain, targetChain: opts.targetChain,
      sinceMs: opts.sinceMs, untilMs: opts.untilMs, maxRows: opts.maxRows ?? 5000, budget: 3000,
    });
    const added = await this.bridges.upsertMany(rows.map((r) => this.bridges.rowToEntity(r)));
    this.logger.log(
      `Backfill ${opts.sourceChain}${opts.targetChain ? '→' + opts.targetChain : ''} ` +
      `[${new Date(opts.sinceMs).toISOString().slice(0, 10)}..${new Date(opts.untilMs).toISOString().slice(0, 10)}]: ` +
      `fetched ${rows.length}, +${added} new${outOfRange ? ' (window partly out of range)' : ''}`,
    );
    return { added, fetched: rows.length, outOfRange };
  }

  // Backfill every source chain over a window (used for full-history seeding).
  async backfillAll(sinceMs: number, untilMs: number): Promise<number> {
    let added = 0;
    for (const source of ORBITER_CHAIN_IDS) {
      added += (await this.backfill({ sourceChain: source, sinceMs, untilMs })).added;
    }
    return added;
  }

  // Fill addresses for unenriched rows via the hash-lookup endpoint (~6mo range).
  async enrichOnce(batch: number): Promise<number> {
    const rows = await this.bridges.unenriched(batch);
    if (!rows.length) return 0;
    let filled = 0;
    const pool = 5;
    for (let i = 0; i < rows.length; i += pool) {
      await Promise.all(rows.slice(i, i + pool).map(async (b) => {
        const l = await this.client.lookupTx(b.sourceId);
        if (l) { await this.bridges.applyLookup(b.sourceId, l); filled++; }
        else { await this.bridges.markEnriched(b.sourceId); } // older than lookup range — stop retrying
      }));
    }
    if (filled) this.logger.log(`Enriched ${filled}/${rows.length} bridges with addresses`);
    return filled;
  }
}
