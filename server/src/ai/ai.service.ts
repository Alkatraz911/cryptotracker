import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from './llm.provider';
import { KnowledgeService, KnowledgeEntry } from './knowledge.service';

// Subgraph the frontend posts for analysis (a slice of the in-memory graph).
export interface AiNode {
  id: string;
  kind: string;
  label?: string;
  address?: string | null;
  net?: string | null;
  nets?: string[] | null;
  entityName?: string | null;
  tag?: string | null;
  note?: string | null;
  amount?: number | null;
  coin?: string | null;
  chainName?: string | null;
}
export interface AiEdge { source: string; target: string; type?: string }
export interface AnalyzeInput {
  focusId?: string;
  nodes: AiNode[];
  edges: AiEdge[];
  question?: string;
}

export interface RiskSignal { id: string; label: string; severity: 'info' | 'warn' | 'high' }

export interface AnalyzeResult {
  narrative: string;
  signals: RiskSignal[];
  used: { provider: string; model: string; knowledge: number; nodes: number; edges: number };
  diag: string | null;
}

const EXCHANGE_RE = /(binance|okx|bybit|coinbase|kraken|kucoin|bitfinex|huobi|htx|gate\.io|gateio|mexc|bitget|exchange|deposit)/i;
const MIXER_RE = /(tornado|mixer|wasabi|samourai|sinbad|blender|анонимайзер)/i;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly llm: LlmProvider,
    private readonly knowledge: KnowledgeService,
  ) {}

  health() {
    return {
      provider: this.llm.provider(),
      model: this.llm.model(),
      configured: this.llm.configured(),
      knowledge: this.knowledge.list().length,
    };
  }

  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const nodes = input.nodes ?? [];
    const edges = input.edges ?? [];
    const focus = nodes.find((n) => n.id === input.focusId) ?? nodes[0];

    const signals = this.computeSignals(nodes, edges, focus);
    const addresses = nodes.map((n) => n.address).filter((a): a is string => !!a);
    const knowledge = this.knowledge.retrieve(addresses);

    const facts = this.buildFacts(nodes, edges, focus, signals);
    const knowledgeBlock = this.buildKnowledgeBlock(knowledge);

    const system =
      'Ты — старший аналитик криптовалютных потоков средств (расследования, AML/комплаенс). ' +
      'Тебе дают подграф фондового потока (кошельки, транзакции, мосты, метки бирж/контрактов) и базу знаний. ' +
      'Задача: помочь следователю понять, что происходит, и куда смотреть дальше. ' +
      'Отвечай ТОЛЬКО на русском, кратко и по делу, в формате Markdown с тремя разделами:\n' +
      '1. **Сводка активности** — что это за узел и что с ним происходит.\n' +
      '2. **Подозрительные паттерны и риски** — конкретные сигналы (мосты, миксеры, биржи, дробление, peel-chain). ' +
      'Ссылайся на адреса/суммы/сети из данных.\n' +
      '3. **Рекомендованные шаги** — что проверить или проследить дальше в этом инструменте.\n' +
      'Опирайся на предоставленные паттерны и факты. НЕ выдумывай адреса, суммы или связи, которых нет в данных. ' +
      'Если данных мало — прямо скажи об этом и предложи, что подгрузить.';

    const prompt =
      `# Подграф для анализа\n${facts}\n\n` +
      `# База знаний (паттерны, известные адреса, прошлый фидбэк)\n${knowledgeBlock}\n\n` +
      (input.question ? `# Вопрос следователя\n${input.question}\n\n` : '') +
      'Дай анализ по трём разделам выше.';

    try {
      const { text, provider, model } = await this.llm.complete({ system, prompt });
      return {
        narrative: text,
        signals,
        used: { provider, model, knowledge: knowledge.length, nodes: nodes.length, edges: edges.length },
        diag: null,
      };
    } catch (e) {
      return {
        narrative: '',
        signals,
        used: { provider: this.llm.provider(), model: this.llm.model(), knowledge: knowledge.length, nodes: nodes.length, edges: edges.length },
        diag: (e as Error)?.message ?? String(e),
      };
    }
  }

  // ── Heuristic risk signals (computed locally, also fed to the model) ─────────
  private computeSignals(nodes: AiNode[], edges: AiEdge[], focus?: AiNode): RiskSignal[] {
    const sig: RiskSignal[] = [];
    const labelText = (n: AiNode) => `${n.entityName ?? ''} ${n.label ?? ''} ${n.note ?? ''}`;

    if (edges.some((e) => e.type === 'BRIDGE')) {
      sig.push({ id: 'bridge', label: 'Кроссчейн-мосты в потоке', severity: 'warn' });
    }
    if (nodes.some((n) => MIXER_RE.test(labelText(n)))) {
      sig.push({ id: 'mixer', label: 'Контакт с миксером/анонимайзером', severity: 'high' });
    }
    if (nodes.some((n) => EXCHANGE_RE.test(labelText(n)))) {
      sig.push({ id: 'exchange', label: 'Контакт с биржей (точка вывода)', severity: 'info' });
    }
    if (focus && (focus.nets?.length ?? 0) > 1) {
      sig.push({ id: 'multinet', label: `Активен в нескольких сетях (${focus.nets!.join('·')})`, severity: 'warn' });
    }
    if (focus) {
      const out = edges.filter((e) => e.source === focus.id).length;
      const inc = edges.filter((e) => e.target === focus.id).length;
      if (out >= 6) sig.push({ id: 'fanout', label: `Веерная рассылка (fan-out ×${out})`, severity: 'warn' });
      if (inc >= 6) sig.push({ id: 'fanin', label: `Веерная консолидация (fan-in ×${inc})`, severity: 'warn' });
    }
    const txAmounts = nodes.filter((n) => n.kind === 'Tx' && n.amount != null);
    if (txAmounts.length >= 8) {
      sig.push({ id: 'chain', label: `Длинная цепочка переводов (${txAmounts.length} tx)`, severity: 'info' });
    }
    return sig;
  }

  // ── Compact textual facts from the subgraph for the prompt ──────────────────
  private buildFacts(nodes: AiNode[], edges: AiEdge[], focus: AiNode | undefined, signals: RiskSignal[]): string {
    const lines: string[] = [];
    if (focus) {
      lines.push(
        `Фокус: ${focus.kind} ${focus.entityName ? `«${focus.entityName}» ` : ''}` +
          `${focus.address ?? focus.label ?? focus.id}` +
          `${focus.net && focus.net !== 'UNKNOWN' ? ` (${focus.net})` : ''}` +
          `${focus.nets && focus.nets.length > 1 ? ` [сети: ${focus.nets.join('·')}]` : ''}`,
      );
    }
    const counts = nodes.reduce<Record<string, number>>((a, n) => ((a[n.kind] = (a[n.kind] || 0) + 1), a), {});
    lines.push(`Узлов: ${nodes.length} (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ')}), связей: ${edges.length}.`);

    // Labelled / known counterparties (the interesting nodes).
    const labelled = nodes.filter((n) => n.entityName || n.tag).slice(0, 25);
    if (labelled.length) {
      lines.push('Известные/помеченные узлы:');
      for (const n of labelled) {
        lines.push(
          `  - ${n.entityName ? `«${n.entityName}»` : `[${n.tag}]`} — ${n.address ?? n.label ?? n.id}` +
            `${n.net && n.net !== 'UNKNOWN' ? ` (${n.net})` : ''}`,
        );
      }
    }

    // Transactions (amount + asset) as the value-flow detail.
    const txs = nodes.filter((n) => n.kind === 'Tx').slice(0, 30);
    if (txs.length) {
      lines.push('Транзакции:');
      for (const t of txs) {
        lines.push(`  - ${t.amount != null ? `${t.amount} ${t.coin ?? ''}`.trim() : (t.label ?? 'tx')}${t.chainName ? ` · ${t.chainName}` : t.net && t.net !== 'UNKNOWN' ? ` · ${t.net}` : ''}`);
      }
    }

    // Bridge hops explicitly.
    const bridges = edges.filter((e) => e.type === 'BRIDGE');
    if (bridges.length) lines.push(`Кроссчейн-прыжков (мостов) в подграфе: ${bridges.length}.`);

    if (signals.length) {
      lines.push('Автоматические сигналы риска (эвристика): ' + signals.map((s) => `${s.label} [${s.severity}]`).join('; ') + '.');
    }
    return lines.join('\n');
  }

  private buildKnowledgeBlock(knowledge: KnowledgeEntry[]): string {
    if (!knowledge.length) return '(база знаний пуста)';
    return knowledge
      .map((e) => {
        const tag = e.kind === 'address' ? 'АДРЕС' : e.kind === 'feedback' ? 'ФИДБЭК' : 'ПАТТЕРН';
        const addr = e.address ? ` (${e.network ?? ''} ${e.address})` : '';
        return `- [${tag}] ${e.title}${addr}: ${e.content}`;
      })
      .join('\n');
  }
}
