import { Injectable, Logger } from '@nestjs/common';

// Pluggable LLM backend. Default is a LOCAL model via Ollama (private + free);
// switch to Claude (cloud, higher quality) or any OpenAI-compatible gateway
// (OpenRouter / LM Studio / vLLM / Together…) entirely via env:
//   AI_PROVIDER   ollama | claude | openrouter | openai   (default: ollama)
//   AI_MODEL      model id (required for openrouter/openai; default per provider)
//   OLLAMA_URL    http://localhost:11434      (Ollama HTTP endpoint)
//   ANTHROPIC_API_KEY                         (required for the claude provider)
//   OPENROUTER_API_KEY                        (required for openrouter)
//   OPENROUTER_URL https://openrouter.ai/api/v1 (override if needed)
//   OPENAI_BASE_URL                           (required for the generic openai provider, e.g. http://localhost:1234/v1)
//   OPENAI_API_KEY                            (optional for local OpenAI-compatible servers)
export type AiProvider = 'ollama' | 'claude' | 'openrouter' | 'openai';

export interface LlmRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface LlmResult {
  text: string;
  provider: AiProvider;
  model: string;
}

const DEFAULT_OLLAMA_MODEL = 'llama3.1';
const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8';

@Injectable()
export class LlmProvider {
  private readonly logger = new Logger(LlmProvider.name);

  provider(): AiProvider {
    const p = (process.env.AI_PROVIDER || 'ollama').toLowerCase();
    if (p === 'claude' || p === 'anthropic') return 'claude';
    if (p === 'openrouter') return 'openrouter';
    if (p === 'openai') return 'openai';
    return 'ollama';
  }

  model(): string {
    if (process.env.AI_MODEL) return process.env.AI_MODEL;
    const p = this.provider();
    if (p === 'claude') return DEFAULT_CLAUDE_MODEL;
    if (p === 'ollama') return DEFAULT_OLLAMA_MODEL;
    return ''; // openrouter / openai — model id is namespaced; the operator must set AI_MODEL
  }

  // Whether the active provider looks usable (key present / endpoint + model set).
  configured(): boolean {
    switch (this.provider()) {
      case 'claude': return !!process.env.ANTHROPIC_API_KEY;
      case 'openrouter': return !!process.env.OPENROUTER_API_KEY && !!this.model();
      case 'openai': return !!process.env.OPENAI_BASE_URL && !!this.model();
      default: return true; // ollama: assumed reachable locally
    }
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    switch (this.provider()) {
      case 'claude': return this.completeClaude(req);
      case 'openrouter': return this.completeOpenAi(req, 'openrouter');
      case 'openai': return this.completeOpenAi(req, 'openai');
      default: return this.completeOllama(req);
    }
  }

  // ── Claude (cloud) ─────────────────────────────────────────────────────────
  // Uses the official @anthropic-ai/sdk (dynamically imported so an Ollama-only
  // deployment that never installed it still boots). Adaptive thinking on — this
  // is the "quality" path; we read only the text blocks of the response.
  private async completeClaude(req: LlmRequest): Promise<LlmResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Claude не настроен: задайте ANTHROPIC_API_KEY (или переключите AI_PROVIDER=ollama).');
    }
    const model = this.model();
    let Anthropic: any;
    try {
      Anthropic = (await import('@anthropic-ai/sdk')).default;
    } catch {
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
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim();
    return { text: text || '(пустой ответ модели)', provider: 'claude', model };
  }

  // ── OpenAI-compatible gateways (OpenRouter, LM Studio, vLLM, Together…) ──────
  // OpenRouter and most local servers expose the OpenAI chat-completions shape.
  // This is a distinct, user-chosen provider — not a shim for the Claude path
  // (Claude still goes through the Anthropic SDK above).
  private async completeOpenAi(req: LlmRequest, which: 'openrouter' | 'openai'): Promise<LlmResult> {
    const model = this.model();
    if (!model) {
      throw new Error(
        which === 'openrouter'
          ? 'OpenRouter: задайте AI_MODEL (напр. anthropic/claude-3.5-sonnet или meta-llama/llama-3.1-70b-instruct).'
          : 'OpenAI-совместимый провайдер: задайте AI_MODEL.',
      );
    }
    let base: string;
    let apiKey: string | undefined;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (which === 'openrouter') {
      base = (process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
      apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OpenRouter не настроен: задайте OPENROUTER_API_KEY.');
      headers['X-Title'] = 'CryptoTracker'; // optional OpenRouter attribution
    } else {
      base = (process.env.OPENAI_BASE_URL || '').replace(/\/$/, '');
      if (!base) throw new Error('OpenAI-совместимый провайдер: задайте OPENAI_BASE_URL (напр. http://localhost:1234/v1).');
      apiKey = process.env.OPENAI_API_KEY; // optional for local servers
    }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    let res: Response;
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
    } catch (e) {
      throw new Error(`${which} недоступен (${base}): ${(e as Error)?.message ?? ''}`.trim());
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401) throw new Error(`${which}: неверный API-ключ (401).`);
      if (res.status === 402) throw new Error(`${which}: недостаточно кредитов/платёж требуется (402).`);
      if (res.status === 404) throw new Error(`${which}: модель «${model}» не найдена (404). Проверьте AI_MODEL.`);
      throw new Error(`${which} HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json: any = await res.json();
    const text = (json?.choices?.[0]?.message?.content ?? '').trim();
    return { text: text || '(пустой ответ модели)', provider: which, model };
  }

  // ── Ollama (local) ───────────────────────────────────────────────────────────
  private async completeOllama(req: LlmRequest): Promise<LlmResult> {
    const base = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
    const model = this.model();
    let res: Response;
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
    } catch (e) {
      throw new Error(
        `Локальная модель недоступна (${base}). Запустите Ollama и модель «${model}» ` +
          `(ollama run ${model}), либо переключите AI_PROVIDER=claude. ${(e as Error)?.message ?? ''}`.trim(),
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 404) {
        throw new Error(`Ollama: модель «${model}» не загружена. Выполните: ollama pull ${model}.`);
      }
      throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json: any = await res.json();
    const text = (json?.message?.content ?? '').trim();
    return { text: text || '(пустой ответ модели)', provider: 'ollama', model };
  }
}
