import { Column, Entity, PrimaryColumn } from 'typeorm';

export type TokenStatus = 'trusted' | 'scam' | 'unknown';
export type TokenSource = 'coingecko' | 'heuristic' | 'admin' | 'seen';

@Entity('token_contracts')
export class TokenContract {
  @PrimaryColumn() network!: string;
  @PrimaryColumn() contract!: string;
  @Column({ type: 'varchar', nullable: true }) symbol!: string | null;
  @Column({ type: 'varchar', nullable: true }) name!: string | null;
  @Column({ type: 'integer', nullable: true }) decimals!: number | null;
  @Column() status!: TokenStatus;
  @Column() source!: TokenSource;
  @Column({ type: 'varchar', nullable: true }) reason!: string | null;
  @Column({ name: 'coingecko_id', type: 'varchar', nullable: true }) coingeckoId!: string | null;
  @Column({ name: 'seen_count', type: 'integer', default: 0 }) seenCount!: number;
  @Column({ name: 'first_seen', type: 'timestamptz', default: () => 'now()' }) firstSeen!: Date;
  @Column({ name: 'last_seen', type: 'timestamptz', default: () => 'now()' }) lastSeen!: Date;
  @Column({ name: 'updated_by', type: 'varchar', nullable: true }) updatedBy!: string | null;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' }) updatedAt!: Date;
}
