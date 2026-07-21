import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProviderHealthEntry, SourceStatus } from './entities/provider-health.entity';

export type { SourceStatus };

export interface SourceHealth {
  source: string;
  status: SourceStatus | 'unknown';
  lastOkAt: number | null;
  lastFailAt: number | null;
  lastDriftAt: number | null;
  consecutiveFailures: number;
  totalOk: number;
  totalFail: number;
  totalDrift: number;
  lastNote: string | null;
  lastLatencyMs: number | null;
}

const DEGRADED_AFTER = 3; // consecutive failures before a source is "degraded"

// Health registry for the (scraping/undocumented-API) data sources. It records
// the outcome of every real fetch so the operator can see, via the /explorer/
// health endpoint and the logs, which source is down or has drifted — instead of
// a silent zero that looks like "no transactions". Passive: it reflects what real
// traffic observed. Persisted to Postgres so it survives restarts/cold starts.
@Injectable()
export class ProviderHealthService {
  private readonly logger = new Logger(ProviderHealthService.name);

  constructor(
    @InjectRepository(ProviderHealthEntry)
    private readonly repo: Repository<ProviderHealthEntry>,
  ) {}

  // Record the outcome of a real data-source call. 'ok'/'empty' are healthy and
  // reset the failure streak; 'down'/'drift' are failures. Drift is logged at
  // error level (needs a code fix); a source going down is warned once and again
  // once it crosses the degraded threshold (avoids log spam on a flapping host).
  // Read-modify-write (not a literal upsert): the counters are increments
  // relative to the previous row, which a value-only upsert can't express.
  async record(source: string, status: SourceStatus, opts: { latencyMs?: number; note?: string } = {}): Promise<void> {
    try {
      let h = await this.repo.findOneBy({ source });
      if (!h) {
        h = this.repo.create({
          source, status: 'unknown',
          lastOkAt: null, lastFailAt: null, lastDriftAt: null,
          consecutiveFailures: 0, totalOk: 0, totalFail: 0, totalDrift: 0,
          lastNote: null, lastLatencyMs: null,
        });
      }
      const prev = h.status;
      h.status = status;
      h.lastNote = opts.note ?? null;
      if (opts.latencyMs != null) h.lastLatencyMs = opts.latencyMs;
      const now = Date.now();

      if (status === 'ok' || status === 'empty') {
        h.lastOkAt = now;
        h.totalOk++;
        h.consecutiveFailures = 0;
        if (prev === 'down' || prev === 'drift') this.logger.log(`[health] ${source} recovered (${prev} → ${status})`);
      } else {
        h.lastFailAt = now;
        h.totalFail++;
        h.consecutiveFailures++;
        const msg = `[health] ${source} ${status}${opts.note ? `: ${opts.note}` : ''} (x${h.consecutiveFailures})`;
        if (status === 'drift') {
          h.lastDriftAt = now;
          h.totalDrift++;
          this.logger.error(msg); // parser broke — the scraper needs updating
        } else if (h.consecutiveFailures === 1 || h.consecutiveFailures === DEGRADED_AFTER) {
          this.logger.warn(msg);
        }
      }
      await this.repo.save(h);
    } catch (e) {
      this.logger.warn(`[health] could not persist ${source}: ${(e as Error).message}`);
    }
  }

  // A source that has failed DEGRADED_AFTER+ times in a row — reported by the
  // health endpoint so the UI/operator can flag it.
  async degraded(source: string): Promise<boolean> {
    const h = await this.repo.findOneBy({ source });
    return (h?.consecutiveFailures ?? 0) >= DEGRADED_AFTER;
  }

  async snapshot(): Promise<SourceHealth[]> {
    return this.repo.find({ order: { source: 'ASC' } });
  }
}
