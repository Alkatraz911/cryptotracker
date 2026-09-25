import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OkxLabelTask, OkxTaskStatus } from './entities/okx-label-task.entity';
import { LabelRegistryService, labelKey, sourceRank } from './label-registry.service';

export interface OkxTask { address: string; network: string; txHash: string }
export interface OkxReport {
  address: string;
  status: 'found' | 'none' | 'failed';
  labels: Array<{ address: string; label: string }>;
  error?: string;
}

const LEASE = `interval '2 minutes'`;   // a claimed task not reported by then is handed out again
const MAX_ATTEMPTS = 6;

// Work queue for the OKX-labels userscript. Every address the app looks up
// (any user, any case) lands here unless a person or OKX already labelled it;
// browsers running the script in harvest mode claim a task, open the OKX page
// of a transaction it took part in and report the tags the page shows.
@Injectable()
export class OkxLabelQueueService {
  private readonly logger = new Logger(OkxLabelQueueService.name);
  // Per-instance memo so a label lookup doesn't write to the DB every time:
  // key → whether the queued row already has a tx hash.
  private queued = new Map<string, boolean>();

  constructor(
    @InjectRepository(OkxLabelTask) private readonly repo: Repository<OkxLabelTask>,
    private readonly labels: LabelRegistryService,
  ) {}

  // Fire-and-forget: queue an address (or give a queued one the tx hash it
  // lacked). No-op when the registry already has an OKX or human label.
  enqueue(network: string, address: string, txHash?: string | null): void {
    const key = labelKey(address);
    if (!key || network === 'UNKNOWN') return;
    const had = this.queued.get(key);
    if (had === true || (had === false && !txHash)) return;
    this.queued.set(key, !!txHash);
    void (async () => {
      const cur = await this.labels.forAddress(key);
      if (cur && sourceRank(cur.source) >= sourceRank('okx')) { this.queued.set(key, true); return; }
      await this.repo.query(
        `INSERT INTO okx_label_queue (address, network, tx_hash) VALUES ($1, $2, $3)
         ON CONFLICT (address) DO UPDATE SET tx_hash = EXCLUDED.tx_hash, network = EXCLUDED.network, updated_at = now()
         WHERE okx_label_queue.tx_hash IS NULL AND EXCLUDED.tx_hash IS NOT NULL`,
        [key, network, txHash ?? null],
      );
    })().catch((e) => { this.queued.delete(key); this.logger.warn(`enqueue ${key}: ${(e as Error)?.message}`); });
  }

  // Hand the next task to a harvesting browser. Newest first — whoever is
  // building a graph right now gets their labels soonest. Rows that got a
  // human/OKX label in the meantime are closed instead of handed out.
  async claim(by: string): Promise<OkxTask | null> {
    for (let i = 0; i < 10; i++) {
      const res = await this.repo.query(
        `UPDATE okx_label_queue q SET claimed_at = now(), claimed_by = $1, attempts = q.attempts + 1
         WHERE q.address = (
           SELECT address FROM okx_label_queue
           WHERE tx_hash IS NOT NULL
             AND (claimed_at IS NULL OR claimed_at < now() - ${LEASE})
             AND ((status = 'pending' AND attempts < ${MAX_ATTEMPTS})
               OR (status = 'failed' AND attempts < ${MAX_ATTEMPTS} AND updated_at < now() - interval '1 hour')
               OR (status = 'none' AND updated_at < now() - interval '30 days'))
           ORDER BY (status = 'pending') DESC, created_at DESC
           LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING q.address, q.network, q.tx_hash`,
        [by],
      );
      // TypeORM's postgres driver returns [rows, rowCount] for UPDATE … RETURNING
      const row = (Array.isArray(res[0]) ? res[0][0] : res[0]) as { address: string; network: string; tx_hash: string } | undefined;
      if (!row) return null;
      const cur = await this.labels.forAddress(row.address);
      if (cur && sourceRank(cur.source) >= sourceRank('okx')) { await this.markDone([row.address]); continue; }
      return { address: row.address, network: row.network, txHash: row.tx_hash };
    }
    return null;
  }

  // What the browser saw on the tx page: tags for any address on it (both
  // sides at least), and whether the claimed address itself had one.
  async report(by: string, r: OkxReport): Promise<{ saved: number }> {
    const saved = await this.labels.learn(r.labels, 'okx', by);
    const key = labelKey(r.address);
    const labelled = new Set(r.labels.map((l) => labelKey(l.address)));
    await this.markDone([...labelled]);
    if (!labelled.has(key)) {
      const status: OkxTaskStatus = r.status === 'failed' ? 'failed' : 'none';
      await this.repo.query(
        `UPDATE okx_label_queue SET status = $2, last_error = $3, claimed_at = NULL, updated_at = now()
         WHERE address = $1 AND status <> 'done'`,
        [key, status, r.error?.slice(0, 250) ?? null],
      );
    }
    return { saved: saved.length };
  }

  async markDone(addresses: string[]): Promise<void> {
    const keys = [...new Set(addresses.map(labelKey).filter(Boolean))];
    if (!keys.length) return;
    for (const k of keys) this.queued.set(k, true);
    await this.repo.query(
      `UPDATE okx_label_queue SET status = 'done', last_error = NULL, claimed_at = NULL, updated_at = now()
       WHERE address = ANY($1) AND status <> 'done'`,
      [keys],
    );
  }

  // Counts per status (+ pending ones still waiting for a tx hash).
  async stats(): Promise<Record<string, number>> {
    const rows: Array<{ status: string; n: string; nohash: string }> = await this.repo.query(
      `SELECT status, count(*) AS n, count(*) FILTER (WHERE tx_hash IS NULL) AS nohash FROM okx_label_queue GROUP BY status`,
    );
    const out: Record<string, number> = { pending: 0, done: 0, none: 0, failed: 0, waitingTx: 0 };
    for (const r of rows) {
      out[r.status] = Number(r.n);
      if (r.status === 'pending') out.waitingTx = Number(r.nohash);
    }
    return out;
  }
}
