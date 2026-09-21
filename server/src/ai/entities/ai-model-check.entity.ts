import { Column, Entity, PrimaryColumn } from 'typeorm';

// Last known health of an LLM model id ("does it actually answer?"). Written by
// explicit probes and by real analyze calls that fail on the model itself, read
// by the model picker so the team sees which entries are live. Shared across
// users and serverless invocations — that's why it's a table, not memory.
@Entity('ai_model_checks')
export class AiModelCheck {
  @PrimaryColumn()
  model!: string;

  @Column()
  ok!: boolean;

  @Column({ type: 'varchar', nullable: true })
  error!: string | null;

  @Column({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs!: number | null;

  @Column({ name: 'checked_at', type: 'timestamptz' })
  checkedAt!: Date;
}
