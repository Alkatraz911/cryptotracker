import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type FeedbackKind = 'bug' | 'idea';
export type FeedbackStatus = 'new' | 'done';

// A bug report or improvement suggestion sent from the in-app feedback form.
// `context` is what the client attached automatically (page, build, viewport,
// current project) so the reporter doesn't have to describe their setup.
@Entity('feedback_entries')
@Index(['status'])
@Index(['createdAt'])
export class FeedbackEntry {
  @PrimaryGeneratedColumn('increment')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  // Denormalised so the admin list survives the user being deleted.
  @Column()
  email!: string;

  @Column({ type: 'varchar' })
  kind!: FeedbackKind;

  @Column()
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'jsonb', nullable: true })
  context!: Record<string, unknown> | null;

  @Column({ type: 'varchar', default: 'new' })
  status!: FeedbackStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
