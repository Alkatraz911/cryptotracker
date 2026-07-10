import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

// The outcome of a single data-source call. The two failure kinds are kept
// distinct because they need different responses:
//   ok    — data returned (source healthy).
//   empty — source reachable, but genuinely no data (a legitimate zero).
//   down  — source unreachable/blocked/HTTP error/timeout (transient — retry).
//   drift — reachable (HTTP 200 with content), but our parser extracted nothing
//           from non-empty markup → the site changed its layout and the scraper
//           needs a CODE fix. Retrying won't help; this must be surfaced loudly.
export type SourceStatus = 'ok' | 'empty' | 'down' | 'drift';

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
// traffic observed. The snapshot is persisted to a JSON file (mirroring the AI
// knowledge store) so it survives restarts; set PROVIDER_HEALTH_FILE=off to
// disable persistence (used by tests).
@Injectable()
export class ProviderHealthService {
  private readonly logger = new Logger(ProviderHealthService.name);
  private readonly sources = new Map<string, SourceHealth>();
  private readonly file = process.env.PROVIDER_HEALTH_FILE || './data/provider-health.json';
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.load();
  }

  private load(): void {
    if (this.file === 'off') return;
    try {
      if (!existsSync(this.file)) return;
      const arr = JSON.parse(readFileSync(this.file, 'utf8')) as SourceHealth[];
      for (const h of arr) if (h?.source) this.sources.set(h.source, h);
    } catch (e) {
      this.logger.warn(`[health] could not load ${this.file}: ${(e as Error).message}`);
    }
  }

  // Debounced write — coalesce bursts of records into one file write.
  private scheduleSave(): void {
    if (this.file === 'off' || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 1500);
    this.saveTimer.unref?.(); // don't keep the process alive for a pending write
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.snapshot(), null, 2));
    } catch (e) {
      this.logger.warn(`[health] could not persist ${this.file}: ${(e as Error).message}`);
    }
  }

  private ensure(source: string): SourceHealth {
    let h = this.sources.get(source);
    if (!h) {
      h = {
        source, status: 'unknown',
        lastOkAt: null, lastFailAt: null, lastDriftAt: null,
        consecutiveFailures: 0, totalOk: 0, totalFail: 0, totalDrift: 0,
        lastNote: null, lastLatencyMs: null,
      };
      this.sources.set(source, h);
    }
    return h;
  }

  // Record the outcome of a real data-source call. 'ok'/'empty' are healthy and
  // reset the failure streak; 'down'/'drift' are failures. Drift is logged at
  // error level (needs a code fix); a source going down is warned once and again
  // once it crosses the degraded threshold (avoids log spam on a flapping host).
  record(source: string, status: SourceStatus, opts: { latencyMs?: number; note?: string } = {}): void {
    const h = this.ensure(source);
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
      this.scheduleSave();
      return;
    }

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
    this.scheduleSave();
  }

  // A source that has failed DEGRADED_AFTER+ times in a row — reported by the
  // health endpoint so the UI/operator can flag it.
  degraded(source: string): boolean {
    return (this.sources.get(source)?.consecutiveFailures ?? 0) >= DEGRADED_AFTER;
  }

  snapshot(): SourceHealth[] {
    return [...this.sources.values()].sort((a, b) => a.source.localeCompare(b.source));
  }
}
