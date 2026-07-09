import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Canonical, deduplicated wallet — shared across all projects/users (on-chain
// data is public). Identified by (network, address). `txsLoadedAt` marks that we
// have already pulled this wallet's transfers into the transactions store, so we
// serve from the DB instead of re-fetching the explorer.
@Entity('wallets')
export class Wallet {
  @PrimaryColumn()
  network!: string;

  @PrimaryColumn()
  address!: string;

  @Column({ name: 'entity_label', type: 'varchar', nullable: true })
  entityLabel!: string | null;

  @Column({ name: 'txs_loaded_at', type: 'timestamptz', nullable: true })
  txsLoadedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
