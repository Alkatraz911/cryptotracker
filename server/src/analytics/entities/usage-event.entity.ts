import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// One feature/module use by a user. Recorded automatically (interceptor) for
// data endpoints and via a beacon for client-only modules; aggregated for the
// admin analytics view.
@Entity('usage_events')
@Index(['module'])
@Index(['userId'])
@Index(['createdAt'])
export class UsageEvent {
  @PrimaryGeneratedColumn('increment')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column()
  module!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
