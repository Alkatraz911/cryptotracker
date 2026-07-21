import { Column, Entity, PrimaryColumn } from 'typeorm';

// The outcome of a single data-source call. The two failure kinds are kept
// distinct because they need different responses:
//   ok    — data returned (source healthy).
//   empty — source reachable, but genuinely no data (a legitimate zero).
//   down  — source unreachable/blocked/HTTP error/timeout (transient — retry).
//   drift — reachable (HTTP 200 with content), but our parser extracted nothing
//           from non-empty markup → the site changed its layout and the scraper
//           needs a CODE fix. Retrying won't help; this must be surfaced loudly.
export type SourceStatus = 'ok' | 'empty' | 'down' | 'drift';

// Postgres bigint columns come back as strings by default (JS-number-safety
// default in the pg driver) — transform back to a plain number so the wire
// shape (SourceHealth.lastOkAt: number | null, etc.) doesn't silently change.
const msTransformer = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v == null ? null : Number(v)),
};

@Entity('provider_health')
export class ProviderHealthEntry {
  @PrimaryColumn()
  source!: string;

  @Column({ default: 'unknown' })
  status!: SourceStatus | 'unknown';

  @Column({ type: 'bigint', nullable: true, transformer: msTransformer })
  lastOkAt!: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: msTransformer })
  lastFailAt!: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: msTransformer })
  lastDriftAt!: number | null;

  @Column('int', { default: 0 })
  consecutiveFailures!: number;

  @Column('int', { default: 0 })
  totalOk!: number;

  @Column('int', { default: 0 })
  totalFail!: number;

  @Column('int', { default: 0 })
  totalDrift!: number;

  @Column({ type: 'varchar', nullable: true })
  lastNote!: string | null;

  @Column({ type: 'bigint', nullable: true, transformer: msTransformer })
  lastLatencyMs!: number | null;
}
