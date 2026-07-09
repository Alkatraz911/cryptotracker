import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// pg returns bigint/numeric as strings; convert to JS numbers on read.
const numberTransformer = {
  to: (v?: number | null) => v ?? null,
  from: (v?: string | null) => (v == null ? null : Number(v)),
};

// Canonical, deduplicated transfer event — shared across all projects/users.
// One row per (network, hash, from, to, asset, amount), keyed by `dedupKey` so
// re-loading a wallet upserts rather than duplicates.
@Entity('transactions')
@Index(['network', 'fromAddr'])
@Index(['network', 'toAddr'])
@Index(['blockTs'])
export class Transaction {
  @PrimaryColumn({ name: 'dedup_key' })
  dedupKey!: string;

  @Column()
  network!: string;

  @Column()
  hash!: string;

  @Column({ name: 'block_ts', type: 'bigint', nullable: true, transformer: numberTransformer })
  blockTs!: number | null;

  @Column({ name: 'from_addr', type: 'varchar', nullable: true })
  fromAddr!: string | null;

  @Column({ name: 'to_addr', type: 'varchar', nullable: true })
  toAddr!: string | null;

  @Column({ type: 'varchar', nullable: true })
  asset!: string | null;

  @Column({ type: 'double precision', nullable: true })
  amount!: number | null;

  @Column({ type: 'double precision', nullable: true })
  usd!: number | null;

  @Column({ name: 'from_label', type: 'varchar', nullable: true })
  fromLabel!: string | null;

  @Column({ name: 'to_label', type: 'varchar', nullable: true })
  toLabel!: string | null;
}
