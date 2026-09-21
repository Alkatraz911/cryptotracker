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
  // Model id chosen by the user in the picker; falls back to AI_MODEL.
  model?: string;
}

// A model the active provider can serve. `free` is only meaningful for
// OpenRouter (zero-priced ids); local/self-hosted models are always "free".
export interface LlmModel {
  id: string;
  name: string;
  free: boolean;
  context?: number | null;
}

// Failure classification so callers can react: a `model_unavailable` error is
// the one worth retrying with another model; the rest are config/network.
export type LlmErrorKind = 'model_unavailable' | 'auth' | 'quota' | 'rate_limit' | 'network' | 'config' | 'refusal' | 'other';
export class LlmError extends Error {
  // `retryAfterMs`: the gateway's hint for a rate limit, when it gave one.
  constructor(message: string, readonly kind: LlmErrorKind, readonly model?: string, readonly retryAfterMs?: number) { super(message); }
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

  // Pick the model for a request: an explicit choice wins over AI_MODEL.
  private modelFor(req: LlmRequest): string {
    return (req.model || '').trim() || this.model();
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
      throw new LlmError('Claude не настроен: задайте ANTHROPIC_API_KEY (или переключите AI_PROVIDER=ollama).', 'config');
    }
    const model = this.modelFor(req);
    let Anthropic: any;
    try {
      Anthropic = (await import('@anthropic-ai/sdk')).default;
    } catch {
      throw new LlmError('Пакет @anthropic-ai/sdk не установлен на сервере (npm i @anthropic-ai/sdk).', 'config');
    }
    const client = new Anthropic({ apiKey });
    let res: any;
    try {
      res = await client.messages.create({
        model,
        max_tokens: req.maxTokens ?? 8000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
      });
    } catch (e: any) {
      const status = Number(e?.status ?? 0);
      const msg = String(e?.message ?? e);
      if (status === 404 || /not_found_error|model.*not found/i.test(msg)) throw new LlmError(`Claude: модель «${model}» не найдена.`, 'model_unavailable', model);
      if (status === 401) throw new LlmError('Claude: неверный API-ключ (401).', 'auth', model);
      if (status === 429) throw new LlmError('Claude: превышен лимит запросов (429).', 'rate_limit', model);
      throw new LlmError(`Claude: ${msg.slice(0, 200)}`, 'other', model);
    }
    if (res.stop_reason === 'refusal') {
      throw new LlmError('Модель отклонила запрос (safety). Уточните формулировку.', 'refusal', model);
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
  // Base URL + auth headers for the OpenAI-compatible providers.
  private openAiEndpoint(which: 'openrouter' | 'openai'): { base: string; headers: Record<string, string> } {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let base: string;
    let apiKey: string | undefined;
    if (which === 'openrouter') {
      base = (process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
      apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new LlmError('OpenRouter не настроен: задайте OPENROUTER_API_KEY.', 'config');
      headers['X-Title'] = 'CryptoTracker'; // optional OpenRouter attribution
    } else {
      base = (process.env.OPENAI_BASE_URL || '').replace(/\/$/, '');
      if (!base) throw new LlmError('OpenAI-совместимый провайдер: задайте OPENAI_BASE_URL (напр. http://localhost:1234/v1).', 'config');
      apiKey = process.env.OPENAI_API_KEY; // optional for local servers
    }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    return { base, headers };
  }

  private async completeOpenAi(req: LlmRequest, which: 'openrouter' | 'openai'): Promise<LlmResult> {
    const model = this.modelFor(req);
    if (!model) {
      throw new LlmError(
        which === 'openrouter'
          ? 'OpenRouter: выберите модель в списке (или задайте AI_MODEL).'
          : 'OpenAI-совместимый провайдер: задайте AI_MODEL.',
        'config',
      );
    }
    const { base, headers } = this.openAiEndpoint(which);

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
      throw new LlmError(`${which} недоступен (${base}): ${(e as Error)?.message ?? ''}`.trim(), 'network', model);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401) throw new LlmError(`${which}: неверный API-ключ (401).`, 'auth', model);
      if (res.status === 402) throw new LlmError(`${which}: недостаточно кредитов/платёж требуется (402).`, 'quota', model);
      if (res.status === 429) {
        // OpenRouter: "temporarily rate-limited upstream … retry_after_seconds".
        let retry = Number(res.headers.get('retry-after')) * 1000 || undefined;
        try { const j = JSON.parse(body); retry = Number(j?.error?.metadata?.retry_after_seconds) * 1000 || retry; } catch { /* not json */ }
        throw new LlmError(`${which}: модель «${model}» перегружена (429) — попробуйте позже или выберите другую.`, 'rate_limit', model, retry);
      }
      // OpenRouter answers a retired/unknown id with 404 "No endpoints found";
      // some gateways use 400 with an "invalid model" message instead. 403 is a
      // per-model policy gate ("only available on agentic harnesses") — the id
      // exists but this key can never use it, so it's just as dead for us.
      if (res.status === 404 || res.status === 403 || /no endpoints|model.*(not found|does not exist|invalid)/i.test(body)) {
        let why = '';
        try { why = String(JSON.parse(body)?.error?.message ?? '').slice(0, 160); } catch { /* ignore */ }
        throw new LlmError(`${which}: модель «${model}» недоступна (${res.status})${why ? `: ${why}` : ''}. Выберите другую в списке.`, 'model_unavailable', model);
      }
      throw new LlmError(`${which} HTTP ${res.status}: ${body.slice(0, 200)}`, 'other', model);
    }
    const json: any = await res.json();
    // OpenRouter can return 200 with an error object (provider-side failure).
    if (json?.error) {
      const msg = String(json.error?.message ?? json.error);
      if (/no endpoints|not found/i.test(msg)) throw new LlmError(`${which}: модель «${model}» недоступна: ${msg}`, 'model_unavailable', model);
      throw new LlmError(`${which}: ${msg.slice(0, 200)}`, 'other', model);
    }
    const text = (json?.choices?.[0]?.message?.content ?? '').trim();
    return { text: text || '(пустой ответ модели)', provider: which, model };
  }

  // ── Model catalogue ─────────────────────────────────────────────────────────
  // What the active provider can serve right now. OpenRouter: the per-key list
  // (falls back to the public one); Ollama: locally pulled models; generic
  // OpenAI: GET /models; Claude: a fixed list of current model ids.
  async listModels(): Promise<LlmModel[]> {
    switch (this.provider()) {
      case 'openrouter': return this.listOpenAiModels('openrouter');
      case 'openai': return this.listOpenAiModels('openai');
      case 'claude': return [
        { id: 'claude-opus-5', name: 'Claude Opus 5', free: false },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', free: false },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', free: false },
        { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', free: false },
      ];
      default: return this.listOllamaModels();
    }
  }

  private async listOpenAiModels(which: 'openrouter' | 'openai'): Promise<LlmModel[]> {
    const { base, headers } = this.openAiEndpoint(which);
    // OpenRouter's /models/user honours the key's provider settings — closer to
    // "what this key can actually call" than the public catalogue.
    const url = which === 'openrouter' ? `${base}/models/user` : `${base}/models`;
    let res = await fetch(url, { headers });
    if (!res.ok && which === 'openrouter') res = await fetch(`${base}/models`, { headers });
    if (!res.ok) throw new LlmError(`${which}: список моделей недоступен (HTTP ${res.status}).`, 'network');
    const json: any = await res.json();
    const rows: any[] = Array.isArray(json?.data) ? json.data : [];
    return rows
      .filter((m) => typeof m?.id === 'string')
      .map((m) => {
        const prompt = Number(m?.pricing?.prompt ?? 0);
        const completion = Number(m?.pricing?.completion ?? 0);
        const free = which === 'openai' ? true : (m.id.endsWith(':free') || (prompt === 0 && completion === 0));
        return { id: m.id as string, name: (m.name as string) || m.id, free, context: m.context_length ?? null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async listOllamaModels(): Promise<LlmModel[]> {
    const base = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
    let res: Response;
    try { res = await fetch(`${base}/api/tags`); }
    catch (e) { throw new LlmError(`Ollama недоступна (${base}): ${(e as Error)?.message ?? ''}`.trim(), 'network'); }
    if (!res.ok) throw new LlmError(`Ollama HTTP ${res.status}`, 'network');
    const json: any = await res.json();
    return ((json?.models ?? []) as any[])
      .map((m) => ({ id: String(m.name ?? m.model), name: String(m.name ?? m.model), free: true, context: null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Ollama (local) ───────────────────────────────────────────────────────────
  private async completeOllama(req: LlmRequest): Promise<LlmResult> {
    const base = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
    const model = this.modelFor(req);
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
      throw new LlmError(
        `Локальная модель недоступна (${base}). Запустите Ollama и модель «${model}» ` +
          `(ollama run ${model}), либо переключите AI_PROVIDER=claude. ${(e as Error)?.message ?? ''}`.trim(),
        'network', model,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 404) {
        throw new LlmError(`Ollama: модель «${model}» не загружена. Выполните: ollama pull ${model}.`, 'model_unavailable', model);
      }
      throw new LlmError(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`, 'other', model);
    }
    const json: any = await res.json();
    const text = (json?.message?.content ?? '').trim();
    return { text: text || '(пустой ответ модели)', provider: 'ollama', model };
  }
}
