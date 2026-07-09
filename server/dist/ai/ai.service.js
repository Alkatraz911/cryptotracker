"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const llm_provider_1 = require("./llm.provider");
const knowledge_service_1 = require("./knowledge.service");
const EXCHANGE_RE = /(binance|okx|bybit|coinbase|kraken|kucoin|bitfinex|huobi|htx|gate\.io|gateio|mexc|bitget|exchange|deposit)/i;
const MIXER_RE = /(tornado|mixer|wasabi|samourai|sinbad|blender|анонимайзер)/i;
let AiService = AiService_1 = class AiService {
    constructor(llm, knowledge) {
        this.llm = llm;
        this.knowledge = knowledge;
        this.logger = new common_1.Logger(AiService_1.name);
    }
    health() {
        return {
            provider: this.llm.provider(),
            model: this.llm.model(),
            configured: this.llm.configured(),
            knowledge: this.knowledge.list().length,
        };
    }
    async analyze(input) {
        const nodes = input.nodes ?? [];
        const edges = input.edges ?? [];
        const focus = nodes.find((n) => n.id === input.focusId) ?? nodes[0];
        const signals = this.computeSignals(nodes, edges, focus);
        const addresses = nodes.map((n) => n.address).filter((a) => !!a);
        const knowledge = this.knowledge.retrieve(addresses);
        const facts = this.buildFacts(nodes, edges, focus, signals);
        const knowledgeBlock = this.buildKnowledgeBlock(knowledge);
        const system = 'Ты — старший аналитик криптовалютных потоков средств (расследования, AML/комплаенс). ' +
            'Тебе дают подграф фондового потока (кошельки, транзакции, мосты, метки бирж/контрактов) и базу знаний. ' +
            'Задача: помочь следователю понять, что происходит, и куда смотреть дальше. ' +
            'Отвечай ТОЛЬКО на русском, кратко и по делу, в формате Markdown с тремя разделами:\n' +
            '1. **Сводка активности** — что это за узел и что с ним происходит.\n' +
            '2. **Подозрительные паттерны и риски** — конкретные сигналы (мосты, миксеры, биржи, дробление, peel-chain). ' +
            'Ссылайся на адреса/суммы/сети из данных.\n' +
            '3. **Рекомендованные шаги** — что проверить или проследить дальше в этом инструменте.\n' +
            'Опирайся на предоставленные паттерны и факты. НЕ выдумывай адреса, суммы или связи, которых нет в данных. ' +
            'Если данных мало — прямо скажи об этом и предложи, что подгрузить.';
        const prompt = `# Подграф для анализа\n${facts}\n\n` +
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
        }
        catch (e) {
            return {
                narrative: '',
                signals,
                used: { provider: this.llm.provider(), model: this.llm.model(), knowledge: knowledge.length, nodes: nodes.length, edges: edges.length },
                diag: e?.message ?? String(e),
            };
        }
    }
    computeSignals(nodes, edges, focus) {
        const sig = [];
        const labelText = (n) => `${n.entityName ?? ''} ${n.label ?? ''} ${n.note ?? ''}`;
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
            sig.push({ id: 'multinet', label: `Активен в нескольких сетях (${focus.nets.join('·')})`, severity: 'warn' });
        }
        if (focus) {
            const out = edges.filter((e) => e.source === focus.id).length;
            const inc = edges.filter((e) => e.target === focus.id).length;
            if (out >= 6)
                sig.push({ id: 'fanout', label: `Веерная рассылка (fan-out ×${out})`, severity: 'warn' });
            if (inc >= 6)
                sig.push({ id: 'fanin', label: `Веерная консолидация (fan-in ×${inc})`, severity: 'warn' });
        }
        const txAmounts = nodes.filter((n) => n.kind === 'Tx' && n.amount != null);
        if (txAmounts.length >= 8) {
            sig.push({ id: 'chain', label: `Длинная цепочка переводов (${txAmounts.length} tx)`, severity: 'info' });
        }
        return sig;
    }
    buildFacts(nodes, edges, focus, signals) {
        const lines = [];
        if (focus) {
            lines.push(`Фокус: ${focus.kind} ${focus.entityName ? `«${focus.entityName}» ` : ''}` +
                `${focus.address ?? focus.label ?? focus.id}` +
                `${focus.net && focus.net !== 'UNKNOWN' ? ` (${focus.net})` : ''}` +
                `${focus.nets && focus.nets.length > 1 ? ` [сети: ${focus.nets.join('·')}]` : ''}`);
        }
        const counts = nodes.reduce((a, n) => ((a[n.kind] = (a[n.kind] || 0) + 1), a), {});
        lines.push(`Узлов: ${nodes.length} (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ')}), связей: ${edges.length}.`);
        const labelled = nodes.filter((n) => n.entityName || n.tag).slice(0, 25);
        if (labelled.length) {
            lines.push('Известные/помеченные узлы:');
            for (const n of labelled) {
                lines.push(`  - ${n.entityName ? `«${n.entityName}»` : `[${n.tag}]`} — ${n.address ?? n.label ?? n.id}` +
                    `${n.net && n.net !== 'UNKNOWN' ? ` (${n.net})` : ''}`);
            }
        }
        const txs = nodes.filter((n) => n.kind === 'Tx').slice(0, 30);
        if (txs.length) {
            lines.push('Транзакции:');
            for (const t of txs) {
                lines.push(`  - ${t.amount != null ? `${t.amount} ${t.coin ?? ''}`.trim() : (t.label ?? 'tx')}${t.chainName ? ` · ${t.chainName}` : t.net && t.net !== 'UNKNOWN' ? ` · ${t.net}` : ''}`);
            }
        }
        const bridges = edges.filter((e) => e.type === 'BRIDGE');
        if (bridges.length)
            lines.push(`Кроссчейн-прыжков (мостов) в подграфе: ${bridges.length}.`);
        if (signals.length) {
            lines.push('Автоматические сигналы риска (эвристика): ' + signals.map((s) => `${s.label} [${s.severity}]`).join('; ') + '.');
        }
        return lines.join('\n');
    }
    buildKnowledgeBlock(knowledge) {
        if (!knowledge.length)
            return '(база знаний пуста)';
        return knowledge
            .map((e) => {
            const tag = e.kind === 'address' ? 'АДРЕС' : e.kind === 'feedback' ? 'ФИДБЭК' : 'ПАТТЕРН';
            const addr = e.address ? ` (${e.network ?? ''} ${e.address})` : '';
            return `- [${tag}] ${e.title}${addr}: ${e.content}`;
        })
            .join('\n');
    }
};
exports.AiService = AiService;
exports.AiService = AiService = AiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [llm_provider_1.LlmProvider,
        knowledge_service_1.KnowledgeService])
], AiService);
//# sourceMappingURL=ai.service.js.map