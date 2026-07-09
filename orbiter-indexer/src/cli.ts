import 'reflect-metadata';
// Run ingestion tasks without the HTTP server. Disable the background timers so
// the CLI does exactly one job and exits.
process.env.CRAWL_ENABLED = 'false';
process.env.ENRICH_ENABLED = 'false';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { IngestService } from './orbiter/ingest.service';
import { BridgesService } from './orbiter/bridges.service';
import { ORBITER_CHAIN_IDS } from './orbiter/orbiter.client';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const CHUNK_MS = 30 * 86_400_000; // backfill in 30-day windows to stay bounded

async function main() {
  const log = new Logger('CLI');
  const cmd = process.argv[2];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const ingest = app.get(IngestService);
  const bridges = app.get(BridgesService);

  try {
    switch (cmd) {
      case 'crawl': {
        const n = await ingest.crawlForward(Number(arg('maxPages') ?? 60));
        log.log(`crawl done: +${n}`);
        break;
      }
      case 'enrich': {
        let total = 0, n: number;
        const batch = Number(arg('batch') ?? 200);
        do { n = await ingest.enrichOnce(batch); total += n; } while (n > 0 && arg('once') === undefined);
        log.log(`enrich done: ${total} filled`);
        break;
      }
      case 'stats': {
        log.log(JSON.stringify(await bridges.stats(), null, 2));
        break;
      }
      case 'reclassify': {
        const n = await bridges.reclassify();
        log.log(`reclassify done: ${n} rows updated with chain names/net`);
        break;
      }
      case 'backfill': {
        const from = arg('from');
        if (!from || isNaN(Date.parse(from))) { log.error('--from <ISO date> required'); break; }
        const fromMs = Date.parse(from);
        const toMs = arg('to') ? Date.parse(arg('to')!) : Date.now();
        const target = arg('target');
        const sources = arg('source') ? [arg('source')!] : ORBITER_CHAIN_IDS;
        const usePairs = arg('pairs') !== undefined && !target;

        // Build the list of feeds to crawl. Pair feeds (source→target) are
        // sparser and reach deeper history; --pairs iterates every ordered pair
        // for MAXIMUM depth (slower: up to 90 feeds).
        const jobs: { source: string; target?: string }[] = [];
        for (const s of sources) {
          if (usePairs) ORBITER_CHAIN_IDS.forEach((t) => { if (t !== s) jobs.push({ source: s, target: t }); });
          else jobs.push({ source: s, target });
        }
        log.log(`backfill: ${jobs.length} feed(s), ${new Date(fromMs).toISOString().slice(0, 10)} → ${new Date(toMs).toISOString().slice(0, 10)}`);

        let grand = 0;
        for (const job of jobs) {
          const tag = `${job.source}${job.target ? '→' + job.target : ''}`;
          let until = toMs;
          while (until > fromMs) {
            const since = Math.max(fromMs, until - CHUNK_MS);
            const res = await ingest.backfill({ sourceChain: job.source, targetChain: job.target, sinceMs: since, untilMs: until });
            grand += res.added;
            // Past reachable depth (locator out of range, nothing fetched) → stop this feed.
            if (res.fetched === 0 && res.outOfRange) { log.warn(`${tag}: reached reachable floor, stopping`); break; }
            until = since;
          }
        }
        log.log(`backfill done: +${grand} new bridges total`);
        break;
      }
      default:
        log.log('Usage: cli <crawl|enrich|stats|reclassify|backfill> [--source <id>] [--target <id>] [--pairs] [--from <ISO>] [--to <ISO>] [--batch N]');
    }
  } finally {
    await app.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
