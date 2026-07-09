import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

// One Orbiter cross-chain bridge transfer. Keyed by the source tx hash.
// Addresses are lowercased for case-insensitive lookup and are filled in by the
// enrichment pass (the bulk feed has no addresses; the hash-lookup endpoint does).
@Entity('orbiter_bridges')
@Index('idx_ob_sender', ['sender'])
@Index('idx_ob_receiver', ['receiver'])
@Index('idx_ob_target_addr', ['targetAddress'])
@Index('idx_ob_target_id', ['targetId'])
@Index('idx_ob_window', ['sourceChain', 'targetChain', 'sourceTime'])
export class OrbiterBridge {
  @PrimaryColumn({ name: 'source_id' })
  sourceId!: string;

  @Column({ name: 'target_id', type: 'varchar', nullable: true })
  targetId!: string | null;

  @Column({ name: 'source_chain' })
  sourceChain!: string;

  @Column({ name: 'target_chain' })
  targetChain!: string;

  // Human-readable classifiers resolved from the chain registry on insert
  // (so raw rows / API responses show names, not just numeric chain ids).
  @Column({ name: 'source_chain_name', type: 'varchar', nullable: true })
  sourceChainName!: string | null;

  @Column({ name: 'target_chain_name', type: 'varchar', nullable: true })
  targetChainName!: string | null;

  @Column({ name: 'source_net', type: 'varchar', nullable: true })
  sourceNet!: string | null;

  @Column({ name: 'target_net', type: 'varchar', nullable: true })
  targetNet!: string | null;

  @Column({ type: 'varchar', nullable: true })
  sender!: string | null;

  @Column({ type: 'varchar', nullable: true })
  receiver!: string | null;

  @Column({ name: 'target_address', type: 'varchar', nullable: true })
  targetAddress!: string | null;

  @Column({ type: 'double precision', nullable: true })
  amount!: number | null;

  @Column({ type: 'varchar', nullable: true })
  symbol!: string | null;

  @Column({ type: 'double precision', nullable: true })
  usd!: number | null;

  @Column({ name: 'source_time', type: 'timestamptz' })
  @Index('idx_ob_source_time')
  sourceTime!: Date;

  // True once the hash-lookup enrichment has filled (or attempted) addresses.
  @Column({ default: false })
  enriched!: boolean;

  @CreateDateColumn({ name: 'ingested_at', type: 'timestamptz' })
  ingestedAt!: Date;
}
