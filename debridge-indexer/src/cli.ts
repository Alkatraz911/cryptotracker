import 'reflect-metadata';
// Run ingestion tasks without the HTTP server; disable the background timers.
process.env.CRAWL_ENABLED = 'false';
process.env.ENRICH_ENABLED = 'false';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { IngestService } from './dln/ingest.service';
import { OrdersService } from './dln/orders.service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const log = new Logger('CLI');
  const cmd = process.argv[2];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const ingest = app.get(IngestService);
  const orders = app.get(OrdersService);

  try {
    switch (cmd) {
      case 'crawl': {
        const n = await ingest.crawlForward(Number(arg('maxPages') ?? 50));
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
      case 'stats':
        log.log(JSON.stringify(await orders.stats(), null, 2));
        break;
      case 'reclassify':
        log.log(`reclassify: ${await orders.reclassify()} rows updated`);
        break;
      case 'backfill': {
        const max = Number(arg('max') ?? 5000);
        const n = await ingest.backfill({ giveChain: arg('give'), takeChain: arg('take'), maxOrders: max });
        log.log(`backfill done: +${n} new orders`);
        break;
      }
      default:
        log.log('Usage: cli <crawl|enrich|stats|reclassify|backfill> [--give <id>] [--take <id>] [--max N] [--batch N]');
    }
  } finally {
    await app.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
