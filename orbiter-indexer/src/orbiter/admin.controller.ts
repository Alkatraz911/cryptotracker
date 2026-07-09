import { Body, Controller, Logger, Post, Query } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { BridgesService } from './bridges.service';
import { BackfillDto } from './dto/backfill.dto';

@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly ingest: IngestService,
    private readonly bridges: BridgesService,
  ) {}

  // Trigger a forward catch-up crawl now.
  @Post('crawl')
  async crawl() { return { added: await this.ingest.crawlForward() }; }

  // Backfill chain name/net classifiers on existing rows.
  @Post('reclassify')
  async reclassify() { return { updated: await this.bridges.reclassify() }; }

  // Run one address-enrichment batch.
  @Post('enrich')
  async enrich(@Query('batch') batch?: string) {
    return { filled: await this.ingest.enrichOnce(batch ? Number(batch) : 100) };
  }

  // Kick off a backfill (runs in the background — watch logs / poll /bridges/stats).
  @Post('backfill')
  backfill(@Body() dto: BackfillDto) {
    const sinceMs = Date.parse(dto.from);
    const untilMs = dto.to ? Date.parse(dto.to) : Date.now();
    if (isNaN(sinceMs)) return { started: false, error: 'invalid "from" date' };

    const run = dto.source
      ? this.ingest.backfill({ sourceChain: dto.source, targetChain: dto.target, sinceMs, untilMs })
      : this.ingest.backfillAll(sinceMs, untilMs);
    run.catch((e) => this.logger.error(`backfill failed: ${(e as Error).message}`));

    return { started: true, source: dto.source ?? 'all', from: new Date(sinceMs).toISOString(), to: new Date(untilMs).toISOString() };
  }
}
