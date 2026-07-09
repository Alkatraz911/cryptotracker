"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var LlmProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmProvider = void 0;
const common_1 = require("@nestjs/common");
const DEFAULT_OLLAMA_MODEL = 'llama3.1';
const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8';
let LlmProvider = LlmProvider_1 = class LlmProvider {
    constructor() {
        this.logger = new common_1.Logger(LlmProvider_1.name);
    }
    provider() {
        const p = (process.env.AI_PROVIDER || 'ollama').toLowerCase();
        if (p === 'claude' || p === 'anthropic')
            return 'claude';
        if (p === 'openrouter')
            return 'openrouter';
        if (p === 'openai')
            return 'openai';
        return 'ollama';
    }
    model() {
        if (process.env.AI_MODEL)
            return process.env.AI_MODEL;
        const p = this.provider();
        if (p === 'claude')
            return DEFAULT_CLAUDE_MODEL;
        if (p === 'ollama')
            return DEFAULT_OLLAMA_MODEL;
        return '';
    }
    configured() {
        switch (this.provider()) {
            case 'claude': return !!process.env.ANTHROPIC_API_KEY;
            case 'openrouter': return !!process.env.OPENROUTER_API_KEY && !!this.model();
            case 'openai': return !!process.env.OPENAI_BASE_URL && !!this.model();
            default: return true;
        }
    }
    async complete(req) {
        switch (this.provider()) {
            case 'claude': return this.completeClaude(req);
            case 'openrouter': return this.completeOpenAi(req, 'openrouter');
            case 'openai': return this.completeOpenAi(req, 'openai');
            default: return this.completeOllama(req);
        }
    }
    async completeClaude(req) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error('Claude не настроен: задайте ANTHROPIC_API_KEY (или переключите AI_PROVIDER=ollama).');
        }
        const model = this.model();
        let Anthropic;
        try {
            Anthropic = (await Promise.resolve().then(() => require('@anthropic-ai/sdk'))).default;
        }
        catch {
            throw new Error('Пакет @anthropic-ai/sdk не установлен на сервере (npm i @anthropic-ai/sdk).');
        }
        const client = new Anthropic({ apiKey });
        const res = await client.messages.create({
            model,
            max_tokens: req.maxTokens ?? 8000,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            system: req.system,
            messages: [{ role: 'user', content: req.prompt }],
        });
        if (res.stop_reason === 'refusal') {
            throw new Error('Модель отклонила запрос (safety). Уточните формулировку.');
        }
        const text = (res.content || [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim();
        return { text: text || '(пустой ответ модели)', provider: 'claude', model };
    }
    async completeOpenAi(req, which) {
        const model = this.model();
        if (!model) {
            throw new Error(which === 'openrouter'
                ? 'OpenRouter: задайте AI_MODEL (напр. anthropic/claude-3.5-sonnet или meta-llama/llama-3.1-70b-instruct).'
                : 'OpenAI-совместимый провайдер: задайте AI_MODEL.');
        }
        let base;
        let apiKey;
        const headers = { 'Content-Type': 'application/json' };
        if (which === 'openrouter') {
            base = (process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
            apiKey = process.env.OPENROUTER_API_KEY;
            if (!apiKey)
                throw new Error('OpenRouter не настроен: задайте OPENROUTER_API_KEY.');
            headers['X-Title'] = 'CryptoTracker';
        }
        else {
            base = (process.env.OPENAI_BASE_URL || '').replace(/\/$/, '');
            if (!base)
                throw new Error('OpenAI-совместимый провайдер: задайте OPENAI_BASE_URL (напр. http://localhost:1234/v1).');
            apiKey = process.env.OPENAI_API_KEY;
        }
        if (apiKey)
            headers['Authorization'] = `Bearer ${apiKey}`;
        let res;
        try {
            res = await fetch(`${base}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model,
                    temperature: 0.3,
                    max_tokens: req.maxTokens ?? 4000,
                    messages: [
                        { role: 'system', content: req.system },
                        { role: 'user', content: req.prompt },
                    ],
                }),
            });
        }
        catch (e) {
            throw new Error(`${which} недоступен (${base}): ${e?.message ?? ''}`.trim());
        }
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            if (res.status === 401)
                throw new Error(`${which}: неверный API-ключ (401).`);
            if (res.status === 402)
                throw new Error(`${which}: недостаточно кредитов/платёж требуется (402).`);
            if (res.status === 404)
                throw new Error(`${which}: модель «${model}» не найдена (404). Проверьте AI_MODEL.`);
            throw new Error(`${which} HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
        const json = await res.json();
        const text = (json?.choices?.[0]?.message?.content ?? '').trim();
        return { text: text || '(пустой ответ модели)', provider: which, model };
    }
    async completeOllama(req) {
        const base = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
        const model = this.model();
        let res;
        try {
            res = await fetch(`${base}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    stream: false,
                    options: { temperature: 0.3 },
                    messages: [
                        { role: 'system', content: req.system },
                        { role: 'user', content: req.prompt },
                    ],
                }),
            });
        }
        catch (e) {
            throw new Error(`Локальная модель недоступна (${base}). Запустите Ollama и модель «${model}» ` +
                `(ollama run ${model}), либо переключите AI_PROVIDER=claude. ${e?.message ?? ''}`.trim());
        }
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            if (res.status === 404) {
                throw new Error(`Ollama: модель «${model}» не загружена. Выполните: ollama pull ${model}.`);
            }
            throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
        const json = await res.json();
        const text = (json?.message?.content ?? '').trim();
        return { text: text || '(пустой ответ модели)', provider: 'ollama', model };
    }
};
exports.LlmProvider = LlmProvider;
exports.LlmProvider = LlmProvider = LlmProvider_1 = __decorate([
    (0, common_1.Injectable)()
], LlmProvider);
//# sourceMappingURL=llm.provider.js.map