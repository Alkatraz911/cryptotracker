"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var KnowledgeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path = require("path");
const SEED = [
    {
        kind: 'pattern', title: 'Peel chain (последовательное "отщипывание")', weight: 3, source: 'seed',
        content: 'Средства проходят через длинную цепочку кошельков, на каждом шаге небольшая сумма отделяется ' +
            'на биржу/вывод, а остаток идёт дальше. Признак отмывания: много одноразовых промежуточных адресов, ' +
            'убывающие суммы, частые мелкие отправки на биржевые депозиты.',
    },
    {
        kind: 'pattern', title: 'Layering через мосты (bridge hopping)', weight: 3, source: 'seed',
        content: 'Перевод между сетями через мосты (Orbiter, deBridge/DLN) для разрыва прослеживаемости. ' +
            'Несколько последовательных кроссчейн-прыжков, особенно с быстрой сменой сети и консолидацией на той стороне, ' +
            '— сильный сигнал сокрытия источника.',
    },
    {
        kind: 'pattern', title: 'Вывод через биржу (cash-out)', weight: 2, source: 'seed',
        content: 'Поток заканчивается на депозитном адресе централизованной биржи (Binance, OKX, Bybit и т.п.) — ' +
            'точка вывода в фиат. Это терминал расследования: дальше нужен запрос к бирже по KYC. ' +
            'Отметьте такие узлы как точки выхода.',
    },
    {
        kind: 'pattern', title: 'Контакт с миксером', weight: 4, source: 'seed',
        content: 'Взаимодействие с Tornado Cash / sanctioned-миксерами или сервисами анонимизации — высокий риск. ' +
            'Входящие из микшера обнуляют прослеживаемость источника; исходящие в микшер — попытка сокрытия.',
    },
    {
        kind: 'pattern', title: 'Fan-out / fan-in (дробление и консолидация)', weight: 2, source: 'seed',
        content: 'Fan-out: один адрес рассылает средства на множество кошельков (дробление, smurfing). ' +
            'Fan-in: множество адресов сходятся в один (консолидация перед выводом). ' +
            'Резкая звезда из переводов вокруг узла заслуживает внимания.',
    },
    {
        kind: 'pattern', title: 'Один EVM-адрес в нескольких сетях', weight: 1, source: 'seed',
        content: 'Один и тот же 0x-адрес активен в ETH/BSC/Arbitrum/Base и др. — это один владелец (адреса EVM ' +
            'chain-agnostic). Активность сразу в нескольких сетях помогает связать поведение и найти вывод там, ' +
            'где его не ждут.',
    },
];
let KnowledgeService = KnowledgeService_1 = class KnowledgeService {
    constructor() {
        this.logger = new common_1.Logger(KnowledgeService_1.name);
        this.entries = [];
        this.file = process.env.AI_KNOWLEDGE_FILE || path.join(process.cwd(), 'data', 'ai-knowledge.json');
    }
    async onModuleInit() {
        try {
            const raw = await fs_1.promises.readFile(this.file, 'utf8');
            const parsed = JSON.parse(raw);
            this.entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
            this.logger.log(`Загружено знаний: ${this.entries.length} (${this.file})`);
        }
        catch {
            this.entries = SEED.map((s) => this.materialize(s));
            await this.persist();
            this.logger.log(`Создана база знаний с ${this.entries.length} паттернами (${this.file})`);
        }
    }
    materialize(s) {
        return {
            id: (0, crypto_1.randomUUID)(),
            createdAt: new Date().toISOString(),
            ...s,
            address: s.address ? s.address.toLowerCase() : s.address ?? null,
        };
    }
    async persist() {
        try {
            await fs_1.promises.mkdir(path.dirname(this.file), { recursive: true });
            await fs_1.promises.writeFile(this.file, JSON.stringify({ entries: this.entries }, null, 2), 'utf8');
        }
        catch (e) {
            this.logger.error(`Не удалось сохранить базу знаний: ${e?.message}`);
        }
    }
    list() {
        return [...this.entries].sort((a, b) => b.weight - a.weight || b.createdAt.localeCompare(a.createdAt));
    }
    async add(e) {
        const entry = this.materialize({
            kind: e.kind,
            network: e.network ?? null,
            address: e.address ?? null,
            title: e.title,
            content: e.content,
            weight: e.weight ?? 1,
            source: e.source ?? 'analyst',
        });
        if (entry.kind === 'address' && entry.address) {
            const i = this.entries.findIndex((x) => x.kind === 'address' && x.address === entry.address && (x.network ?? '') === (entry.network ?? ''));
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
    async remove(id) {
        const before = this.entries.length;
        this.entries = this.entries.filter((e) => e.id !== id);
        if (this.entries.length !== before) {
            await this.persist();
            return true;
        }
        return false;
    }
    retrieve(addresses, limitGuidance = 20) {
        const wanted = new Set(addresses.map((a) => a.toLowerCase()));
        const byAddress = this.entries.filter((e) => e.kind === 'address' && e.address && wanted.has(e.address));
        const guidance = this.entries
            .filter((e) => e.kind === 'pattern' || e.kind === 'feedback')
            .sort((a, b) => b.weight - a.weight || b.createdAt.localeCompare(a.createdAt))
            .slice(0, limitGuidance);
        return [...byAddress, ...guidance];
    }
    async recordFeedback(opts) {
        const correction = (opts.correction || '').trim();
        if (!correction && opts.rating === 'up')
            return null;
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
};
exports.KnowledgeService = KnowledgeService;
exports.KnowledgeService = KnowledgeService = KnowledgeService_1 = __decorate([
    (0, common_1.Injectable)()
], KnowledgeService);
//# sourceMappingURL=knowledge.service.js.map