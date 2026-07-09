import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

// One deBridge (DLN) cross-chain order. Keyed by orderId. Addresses + dest tx
// are filled by the enrichment pass (the list endpoint lacks them; detail has them).
// Addresses lowercased for case-insensitive lookup.
@Entity('debridge_orders')
@Index('idx_dbo_src_tx', ['srcTx'])
@Index('idx_dbo_dst_tx', ['dstTx'])
@Index('idx_dbo_sender', ['sender'])
@Index('idx_dbo_receiver', ['receiver'])
@Index('idx_dbo_window', ['giveChain', 'takeChain', 'creationTime'])
export class DebridgeOrder {
  @PrimaryColumn({ name: 'order_id' })
  orderId!: string;

  @Column({ name: 'src_tx', type: 'varchar', nullable: true })
  srcTx!: string | null;

  @Column({ name: 'dst_tx', type: 'varchar', nullable: true })
  dstTx!: string | null;

  @Column({ name: 'give_chain' })
  giveChain!: string;

  @Column({ name: 'take_chain' })
  takeChain!: string;

  @Column({ name: 'give_chain_name', type: 'varchar', nullable: true })
  giveChainName!: string | null;

  @Column({ name: 'take_chain_name', type: 'varchar', nullable: true })
  takeChainName!: string | null;

  @Column({ name: 'give_net', type: 'varchar', nullable: true })
  giveNet!: string | null;

  @Column({ name: 'take_net', type: 'varchar', nullable: true })
  takeNet!: string | null;

  @Column({ type: 'varchar', nullable: true })
  sender!: string | null;

  @Column({ type: 'varchar', nullable: true })
  receiver!: string | null;

  @Column({ name: 'give_amount', type: 'double precision', nullable: true })
  giveAmount!: number | null;

  @Column({ name: 'give_symbol', type: 'varchar', nullable: true })
  giveSymbol!: string | null;

  @Column({ name: 'take_amount', type: 'double precision', nullable: true })
  takeAmount!: number | null;

  @Column({ name: 'take_symbol', type: 'varchar', nullable: true })
  takeSymbol!: string | null;

  @Column({ type: 'varchar', nullable: true })
  state!: string | null;

  @Column({ name: 'creation_time', type: 'timestamptz' })
  @Index('idx_dbo_creation_time')
  creationTime!: Date;

  @Column({ default: false })
  enriched!: boolean;

  @CreateDateColumn({ name: 'ingested_at', type: 'timestamptz' })
  ingestedAt!: Date;
}
