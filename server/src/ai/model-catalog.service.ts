import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiModelCheck } from './entities/ai-model-check.entity';
import { LlmError, LlmModel, LlmProvider } from './llm.provider';

export type ModelStatus = 'ok' | 'fail' | 'unknown';
export interface CatalogModel extends LlmModel {
  status: ModelStatus;
  checkedAt: string | null;
  error: string | null;
  latencyMs: number | null;
}

// A probe result is trusted this long; older ones still show but as stale.
const FRESH_MS = 24 * 3600_000;
// Provider catalogues change slowly; don't hit them on every picker open.
const LIST_TTL_MS = 10 * 60_000;

// The model picker's backend: which models the active provider offers, which
// of them are known to answer (probe results + failures seen on real calls),
// and a fallback choice when the configured one has gone away — the thing
// that turns "модель не найдена (404)" into an analysis that still comes back.
@Injectable()
export class ModelCatalogService {
  private readonly logger = new Logger(ModelCatalogService.name);
  private listCache: { at: number; models: LlmModel[] } | null = null;

  constructor(
    private readonly llm: LlmProvider,
    @InjectRepository(AiModelCheck) private readonly checks: Repository<AiModelCheck>,
  ) {}

  // Paid OpenRouter models burn the operator's credits on anyone's click, so
  // they're hidden unless explicitly allowed.
  private allowPaid(): boolean {
    return /^(1|true|yes)$/i.test(process.env.AI_ALLOW_PAID_MODELS ?? '');
  }

  private async providerModels(): Promise<LlmModel[]> {
    if (this.listCache && Date.now() - this.listCache.at < LIST_TTL_MS) return this.listCache.models;
    let models = await this.llm.listModels();
    if (this.llm.provider() === 'openrouter' && !this.allowPaid()) models = models.filter((m) => m.free);
    this.listCache = { at: Date.now(), models };
    return models;
  }

  // The configured AI_MODEL may have vanished from the provider's list (that's
  // exactly the failure mode) — keep it visible so the picker can show it as ✗.
  async list(): Promise<{ provider: string; current: string; allowPaid: boolean; models: CatalogModel[] }> {
    const [models, checks] = await Promise.all([this.providerModels(), this.checks.find()]);
    const byId = new Map(checks.map((c) => [c.model, c]));
    const current = this.llm.model();
    const all = [...models];
    if (current && !all.some((m) => m.id === current)) all.push({ id: current, name: `${current} (из AI_MODEL)`, free: true, context: null });
    const rows: CatalogModel[] = all.map((m) => {
      const c = byId.get(m.id);
      return {
        ...m,
        status: c ? (c.ok ? 'ok' : 'fail') : 'unknown',
        checkedAt: c ? c.checkedAt.toISOString() : null,
        error: c?.error ?? null,
        latencyMs: c?.latencyMs ?? null,
      };
    });
    // Working first, then unchecked, then broken; alphabetical within a group.
    const rank: Record<ModelStatus, number> = { ok: 0, unknown: 1, fail: 2 };
    rows.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
    return { provider: this.llm.provider(), current, allowPaid: this.allowPaid(), models: rows };
  }

  // Is this id something the picker could have offered? Guards /analyze from
  // arbitrary (e.g. paid) ids typed into a request by hand.
  async isAllowed(model: string): Promise<boolean> {
    if (!model) return true;
    if (model === this.llm.model()) return true;
    return (await this.providerModels()).some((m) => m.id === model);
  }

  // One tiny completion: does the model answer at all? Rate limits don't count
  // as "broken" — they'd be a false ✗ on a model that works a minute later.
  async probe(model: string): Promise<{ model: string; ok: boolean; status: ModelStatus; latencyMs: number | null; error: string | null }> {
    // Free pools answer 429 "retry in 5s" a lot; one short wait turns most of
    // those into a real verdict instead of a permanent "?".
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      try {
        const r = await this.llm.complete({ model, system: 'Reply with the single word: ok', prompt: 'ping', maxTokens: 8 });
        const latencyMs = Date.now() - t0;
        const ok = r.text.trim().length > 0 && !r.text.startsWith('(пустой');
        await this.record(model, ok, ok ? null : 'пустой ответ', latencyMs);
        return { model, ok, status: ok ? 'ok' : 'fail', latencyMs, error: ok ? null : 'пустой ответ' };
      } catch (e) {
        const err = e as LlmError;
        const msg = (err?.message ?? String(e)).slice(0, 300);
        if (err?.kind === 'rate_limit') {
          const wait = Math.min(err.retryAfterMs ?? 3000, ModelCatalogService.MAX_RETRY_WAIT_MS);
          if (attempt === 0 && wait > 0) { await new Promise((r) => setTimeout(r, wait)); continue; }
          return { model, ok: false, status: 'unknown', latencyMs: null, error: msg };
        }
        await this.record(model, false, msg, null);
        return { model, ok: false, status: 'fail', latencyMs: null, error: msg };
      }
    }
  }
  // Keep a probe well inside a serverless function's budget.
  private static readonly MAX_RETRY_WAIT_MS = 5000;

  // Called by the analyze path when a real request died on the model itself.
  noteFailure(model: string, error: string): void {
    void this.record(model, false, error.slice(0, 300), null).catch(() => {});
  }

  noteSuccess(model: string, latencyMs: number): void {
    void this.record(model, true, null, latencyMs).catch(() => {});
  }

  private async record(model: string, ok: boolean, error: string | null, latencyMs: number | null): Promise<void> {
    try {
      await this.checks.upsert({ model, ok, error, latencyMs, checkedAt: new Date() }, ['model']);
    } catch (e) {
      this.logger.warn(`record ${model}: ${(e as Error)?.message}`);
    }
  }

  // Alternatives to try when `dead` has gone away, best first: models verified
  // working recently, then unverified ones (never those already marked broken).
  // A retired id fails in a few hundred ms, so trying a handful is cheap — and
  // it's what makes the very first request after a retirement still succeed.
  async fallbackCandidates(dead: string, limit = 3): Promise<string[]> {
    const models = await this.providerModels();
    const ids = new Set(models.map((m) => m.id));
    const checks = await this.checks.find();
    const fresh = (c: AiModelCheck) => Date.now() - c.checkedAt.getTime() < FRESH_MS;
    const verified = checks
      .filter((c) => c.ok && fresh(c) && c.model !== dead && ids.has(c.model))
      .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())
      .map((c) => c.model);
    const broken = new Set(checks.filter((c) => !c.ok && fresh(c)).map((c) => c.model));
    const unverified = models.map((m) => m.id).filter((id) => id !== dead && !verified.includes(id) && !broken.has(id));
    return [...verified, ...unverified].slice(0, limit);
  }
}
