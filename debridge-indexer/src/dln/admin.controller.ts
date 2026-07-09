import { Body, Controller, Logger, Post, Query } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { OrdersService } from './orders.service';
import { BackfillDto } from './dto/backfill.dto';

@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly ingest: IngestService,
    private readonly orders: OrdersService,
  ) {}

  @Post('crawl')
  async crawl() { return { added: await this.ingest.crawlForward() }; }

  @Post('enrich')
  async enrich(@Query('batch') batch?: string) {
    return { filled: await this.ingest.enrichOnce(batch ? Number(batch) : 100) };
  }

  @Post('reclassify')
  async reclassify() { return { updated: await this.orders.reclassify() }; }

  // Kick off a backfill in the background (watch logs / poll /orders/stats).
  @Post('backfill')
  backfill(@Body() dto: BackfillDto) {
    const run = this.ingest.backfill({ giveChain: dto.give, takeChain: dto.take, maxOrders: dto.max ?? 5000 });
    run.catch((e) => this.logger.error(`backfill failed: ${(e as Error).message}`));
    return { started: true, give: dto.give ?? 'all', take: dto.take ?? 'all', max: dto.max ?? 5000 };
  }
}
