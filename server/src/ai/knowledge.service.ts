import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

// RAG knowledge base + feedback dataset, persisted to a plain JSON file (no DB
// migration needed — the main app runs TypeORM with synchronize:false). Three
// kinds of entry feed the model's context at query time:
//   address  — a labelled/known address (exchange, mixer, victim, suspect…)
//   pattern  — a general fund-flow / typology heuristic the model should apply
//   feedback — a correction or guidance captured from the analyst (👍/👎 loop)
export type KnowledgeKind = 'address' | 'pattern' | 'feedback';

export interface KnowledgeEntry {
  id: string;
  kind: KnowledgeKind;
  network?: string | null;
  address?: string | null; // lowercased for address entries (exact-match retrieval)
  title: string;
  content: string;
  weight: number; // ranking hint; corrections/important facts score higher
  source?: string | null; // 'seed' | 'analyst' | 'feedback'
  createdAt: string;
}

const SEED: Array<Omit<KnowledgeEntry, 'id' | 'createdAt'>> = [
  {
    kind: 'pattern', title: 'Peel chain (последовательное "отщипывание")', weight: 3, source: 'seed',
    content:
      'Средства проходят через длинную цепочку кошельков, на каждом шаге небольшая сумма отделяется ' +
      'на биржу/вывод, а остаток идёт дальше. Признак отмывания: много одноразовых промежуточных адресов, ' +
      'убывающие суммы, частые мелкие отправки на биржевые депозиты.',
  },
  {
    kind: 'pattern', title: 'Layering через мосты (bridge hopping)', weight: 3, source: 'seed',
    content:
      'Перевод между сетями через мосты (Orbiter, deBridge/DLN) для разрыва прослеживаемости. ' +
      'Несколько последовательных кроссчейн-прыжков, особенно с быстрой сменой сети и консолидацией на той стороне, ' +
      '— сильный сигнал сокрытия источника.',
  },
  {
    kind: 'pattern', title: 'Вывод через биржу (cash-out)', weight: 2, source: 'seed',
    content:
      'Поток заканчивается на депозитном адресе централизованной биржи (Binance, OKX, Bybit и т.п.) — ' +
      'точка вывода в фиат. Это терминал расследования: дальше нужен запрос к бирже по KYC. ' +
      'Отметьте такие узлы как точки выхода.',
  },
  {
    kind: 'pattern', title: 'Контакт с миксером', weight: 4, source: 'seed',
    content:
      'Взаимодействие с Tornado Cash / sanctioned-миксерами или сервисами анонимизации — высокий риск. ' +
      'Входящие из микшера обнуляют прослеживаемость источника; исходящие в микшер — попытка сокрытия.',
  },
  {
    kind: 'pattern', title: 'Fan-out / fan-in (дробление и консолидация)', weight: 2, source: 'seed',
    content:
      'Fan-out: один адрес рассылает средства на множество кошельков (дробление, smurfing). ' +
      'Fan-in: множество адресов сходятся в один (консолидация перед выводом). ' +
      'Резкая звезда из переводов вокруг узла заслуживает внимания.',
  },
  {
    kind: 'pattern', title: 'Один EVM-адрес в нескольких сетях', weight: 1, source: 'seed',
    content:
      'Один и тот же 0x-адрес активен в ETH/BSC/Arbitrum/Base и др. — это один владелец (адреса EVM ' +
      'chain-agnostic). Активность сразу в нескольких сетях помогает связать поведение и найти вывод там, ' +
      'где его не ждут.',
  },
];

@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);
  private entries: KnowledgeEntry[] = [];
  private readonly file =
    process.env.AI_KNOWLEDGE_FILE || path.join(process.cwd(), 'data', 'ai-knowledge.json');

  async onModuleInit() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      this.logger.log(`Загружено знаний: ${this.entries.length} (${this.file})`);
    } catch {
      // First run — seed baseline typologies so the assistant has domain priors.
      this.entries = SEED.map((s) => this.materialize(s));
      await this.persist();
      this.logger.log(`Создана база знаний с ${this.entries.length} паттернами (${this.file})`);
    }
  }

  private materialize(s: Omit<KnowledgeEntry, 'id' | 'createdAt'>): KnowledgeEntry {
    return {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...s,
      address: s.address ? s.address.toLowerCase() : s.address ?? null,
    };
  }

  private async persist() {
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify({ entries: this.entries }, null, 2), 'utf8');
    } catch (e) {
      this.logger.error(`Не удалось сохранить базу знаний: ${(e as Error)?.message}`);
    }
  }

  list(): KnowledgeEntry[] {
    return [...this.entries].sort((a, b) => b.weight - a.weight || b.createdAt.localeCompare(a.createdAt));
  }

  async add(e: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'weight'> & { weight?: number }): Promise<KnowledgeEntry> {
    const entry = this.materialize({
      kind: e.kind,
      network: e.network ?? null,
      address: e.address ?? null,
      title: e.title,
      content: e.content,
      weight: e.weight ?? 1,
      source: e.source ?? 'analyst',
    });
    // Dedupe address entries by (network,address): update the existing one.
    if (entry.kind === 'address' && entry.address) {
      const i = this.entries.findIndex(
        (x) => x.kind === 'address' && x.address === entry.address && (x.network ?? '') === (entry.network ?? ''),
      );
      if (i >= 0) {
        this.entries[i] = { ...this.entries[i], title: entry.title, content: entry.content, weight: Math.max(this.entries[i].weight, entry.weight) };
        await this.persist();
        return this.entries[i];
      }
    }
    this.entries.push(entry);
    await this.persist();
    return entry;
  }

  async remove(id: string): Promise<boolean> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) { await this.persist(); return true; }
    return false;
  }

  // Retrieve relevant knowledge for an analysis: every address entry whose
  // address appears in the subgraph (exact match — the right signal for crypto
  // addresses), plus the general pattern/feedback guidance (top by weight).
  retrieve(addresses: string[], limitGuidance = 20): KnowledgeEntry[] {
    const wanted = new Set(addresses.map((a) => a.toLowerCase()));
    const byAddress = this.entries.filter(
      (e) => e.kind === 'address' && e.address && wanted.has(e.address),
    );
    const guidance = this.entries
      .filter((e) => e.kind === 'pattern' || e.kind === 'feedback')
      .sort((a, b) => b.weight - a.weight || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limitGuidance);
    return [...byAddress, ...guidance];
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
