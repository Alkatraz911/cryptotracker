import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { KnowledgeEntryEntity, KnowledgeKind } from './entities/knowledge-entry.entity';

// RAG knowledge base + feedback dataset, persisted to Postgres. Three kinds of
// entry feed the model's context at query time:
//   address  — a labelled/known address (exchange, mixer, victim, suspect…)
//   pattern  — a general fund-flow / typology heuristic the model should apply
//   feedback — a correction or guidance captured from the analyst (👍/👎 loop)
export interface KnowledgeEntry {
  id: string;
  kind: KnowledgeKind;
  network?: string | null;
  address?: string | null;
  title: string;
  content: string;
  weight: number;
  source?: string | null;
  createdAt: string;
}

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KnowledgeEntryEntity)
    private readonly repo: Repository<KnowledgeEntryEntity>,
  ) {}

  private toDto(e: KnowledgeEntryEntity): KnowledgeEntry {
    return {
      id: e.id, kind: e.kind, network: e.network, address: e.address,
      title: e.title, content: e.content, weight: e.weight, source: e.source,
      createdAt: e.createdAt.toISOString(),
    };
  }

  async list(): Promise<KnowledgeEntry[]> {
    const rows = await this.repo.find({ order: { weight: 'DESC', createdAt: 'DESC' } });
    return rows.map((r) => this.toDto(r));
  }

  async add(e: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'weight'> & { weight?: number }): Promise<KnowledgeEntry> {
    const address = e.address ? e.address.toLowerCase() : e.address ?? null;
    const network = e.network ?? null;
    const weight = e.weight ?? 1;

    // Dedupe address entries by (network,address): update the existing one.
    if (e.kind === 'address' && address) {
      const existing = await this.repo.findOne({
        where: { kind: 'address', address, network: network === null ? IsNull() : network },
      });
      if (existing) {
        existing.title = e.title;
        existing.content = e.content;
        existing.weight = Math.max(existing.weight, weight);
        await this.repo.save(existing);
        return this.toDto(existing);
      }
    }

    const entity = this.repo.create({
      id: randomUUID(),
      kind: e.kind,
      network,
      address,
      title: e.title,
      content: e.content,
      weight,
      source: e.source ?? 'analyst',
    });
    await this.repo.save(entity);
    return this.toDto(entity);
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.repo.delete({ id });
    return (res.affected ?? 0) > 0;
  }

  // Retrieve relevant knowledge for an analysis: every address entry whose
  // address appears in the subgraph (exact match — the right signal for crypto
  // addresses), plus the general pattern/feedback guidance (top by weight).
  async retrieve(addresses: string[], limitGuidance = 20): Promise<KnowledgeEntry[]> {
    const wanted = addresses.map((a) => a.toLowerCase());
    const byAddress = wanted.length
      ? await this.repo.find({ where: { kind: 'address', address: In(wanted) } })
      : [];
    const guidance = await this.repo.find({
      where: [{ kind: 'pattern' }, { kind: 'feedback' }],
      order: { weight: 'DESC', createdAt: 'DESC' },
      take: limitGuidance,
    });
    return [...byAddress, ...guidance].map((r) => this.toDto(r));
  }

  // Capture analyst feedback into the dataset. Corrections become high-weight
  // 'feedback' guidance so future prompts learn from them (the RAG feedback loop).
  async recordFeedback(opts: {
    rating: 'up' | 'down';
    correction?: string;
    focusAddress?: string | null;
    focusNetwork?: string | null;
  }): Promise<KnowledgeEntry | null> {
    const correction = (opts.correction || '').trim();
    // A bare 👍 with no note carries no reusable signal — acknowledge, don't store.
    if (!correction && opts.rating === 'up') return null;
    const title = opts.rating === 'down' ? 'Коррекция аналитика (👎)' : 'Подтверждение аналитика (👍)';
    const body = correction
      ? correction
      : 'Аналитик отметил вывод как неверный без пояснения — будь осторожнее с подобными заключениями.';
    const scope = opts.focusAddress ? ` [контекст: ${opts.focusNetwork ?? ''} ${opts.focusAddress}]` : '';
    return this.add({
      kind: 'feedback',
      network: opts.focusNetwork ?? null,
      address: opts.focusAddress ? opts.focusAddress.toLowerCase() : null,
      title,
      content: `${body}${scope}`,
      weight: opts.rating === 'down' ? 5 : 2,
      source: 'feedback',
    });
  }
}
