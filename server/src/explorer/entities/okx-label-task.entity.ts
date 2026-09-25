import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// 'pending' — waiting for a browser to open it on OKX; 'done' — the registry
// has an OKX/manual label for it; 'none' — OKX shows no tag (re-checked
// monthly); 'failed' — the page didn't render or the tag couldn't be read.
export type OkxTaskStatus = 'pending' | 'done' | 'none' | 'failed';

// Addresses that still need their OKX Explorer tag. OKX tags can't be fetched
// server-side (signed, bot-checked, encrypted), so the userscript running in a
// team member's browser claims these one by one, opens the transaction page on
// OKX and reports what the page shows. One row per address (same key as
// address_labels); `txHash` is any transaction the address took part in — the
// OKX tx page shows the tags of both its sides.
@Entity('okx_label_queue')
export class OkxLabelTask {
  @PrimaryColumn()
  address!: string;

  // Network of `txHash` (an EVM address is the same on every EVM chain).
  @Column()
  network!: string;

  @Column({ name: 'tx_hash', type: 'varchar', nullable: true })
  txHash!: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status!: OkxTaskStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt!: Date | null;

  @Column({ name: 'claimed_by', type: 'varchar', nullable: true })
  claimedBy!: string | null;

  @Column({ name: 'last_error', type: 'varchar', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
