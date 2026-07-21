import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type KnowledgeKind = 'address' | 'pattern' | 'feedback';

@Entity('knowledge_entries')
export class KnowledgeEntryEntity {
  @PrimaryColumn()
  id!: string;

  @Column()
  kind!: KnowledgeKind;

  @Column({ type: 'varchar', nullable: true })
  network!: string | null;

  @Column({ type: 'varchar', nullable: true })
  address!: string | null; // lowercased for address entries (exact-match retrieval)

  @Column()
  title!: string;

  @Column('text')
  content!: string;

  @Column('int')
  weight!: number; // ranking hint; corrections/important facts score higher

  @Column({ type: 'varchar', nullable: true })
  source!: string | null; // 'seed' | 'analyst' | 'feedback'

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
