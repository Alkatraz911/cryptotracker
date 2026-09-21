import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Where a label came from. Human-entered sources ('manual' — typed in the app,
// 'okx' — copied from the OKX/OKLink explorer) outrank explorer-API tags
// ('tronscan', 'etherscan', …) and are never overwritten by them.
export type LabelSource = 'manual' | 'okx' | 'tronscan' | 'etherscan' | 'solscan' | 'rpc' | string;

// Shared registry of address → entity label ("Binance Hot Wallet", "FixedFloat.
// User"). One row per address: EVM addresses are chain-agnostic and stored
// lowercase; TRON/Solana addresses are case-sensitive and stored as-is.
@Entity('address_labels')
export class AddressLabel {
  @PrimaryColumn()
  address!: string;

  @Column()
  label!: string;

  @Column({ type: 'varchar', default: 'manual' })
  source!: LabelSource;

  // Email of whoever entered it (null for explorer-captured tags).
  @Column({ name: 'created_by', type: 'varchar', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
