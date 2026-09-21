import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ModelCatalogService } from './model-catalog.service';
import { AiModelCheck } from './entities/ai-model-check.entity';
import { LlmError, LlmProvider } from './llm.provider';

const rows: AiModelCheck[] = [];
const mockRepo = {
  find: jest.fn(async (opts?: { where?: { ok?: boolean } }) => {
    const r = rows.filter((x) => opts?.where?.ok == null || x.ok === opts.where.ok);
    return [...r].sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
  }),
  upsert: jest.fn(async (x: AiModelCheck) => {
    const i = rows.findIndex((y) => y.model === x.model);
    if (i >= 0) rows[i] = { ...rows[i], ...x }; else rows.push({ ...x });
  }),
};
const mockLlm = {
  provider: jest.fn(() => 'openrouter'),
  model: jest.fn(() => 'poolside/laguna-m.1:free'),
  listModels: jest.fn(async () => [
    { id: 'z-ai/glm-5.2:free', name: 'GLM 5.2', free: true },
    { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', free: false },
    { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4', free: true },
  ]),
  complete: jest.fn(),
};

describe('ModelCatalogService', () => {
  let service: ModelCatalogService;

  beforeEach(async () => {
    jest.clearAllMocks();
    rows.length = 0;
    delete process.env.AI_ALLOW_PAID_MODELS;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelCatalogService,
        { provide: LlmProvider, useValue: mockLlm },
        { provide: getRepositoryToken(AiModelCheck), useValue: mockRepo },
      ],
    }).compile();
    service = module.get(ModelCatalogService);
  });

  it('hides paid OpenRouter models by default and keeps the configured (dead) one visible', async () => {
    const r = await service.list();
    const ids = r.models.map((m) => m.id);
    expect(ids).not.toContain('anthropic/claude-opus-5');
    expect(ids).toContain('poolside/laguna-m.1:free');
    expect(r.models.every((m) => m.status === 'unknown')).toBe(true);
  });

  it('shows paid models when AI_ALLOW_PAID_MODELS=true', async () => {
    process.env.AI_ALLOW_PAID_MODELS = 'true';
    const r = await service.list();
    expect(r.models.map((m) => m.id)).toContain('anthropic/claude-opus-5');
  });

  it('refuses ids outside the offered list', async () => {
    expect(await service.isAllowed('z-ai/glm-5.2:free')).toBe(true);
    expect(await service.isAllowed('poolside/laguna-m.1:free')).toBe(true); // current AI_MODEL
    expect(await service.isAllowed('anthropic/claude-opus-5')).toBe(false); // paid, hidden
  });

  it('probe records ok / fail, and sorts working models first', async () => {
    mockLlm.complete.mockResolvedValueOnce({ text: 'ok', provider: 'openrouter', model: 'z-ai/glm-5.2:free' });
    const good = await service.probe('z-ai/glm-5.2:free');
    expect(good.ok).toBe(true);

    mockLlm.complete.mockRejectedValueOnce(new LlmError('no endpoints', 'model_unavailable', 'poolside/laguna-m.1:free'));
    const bad = await service.probe('poolside/laguna-m.1:free');
    expect(bad.status).toBe('fail');

    const r = await service.list();
    expect(r.models[0].id).toBe('z-ai/glm-5.2:free');
    expect(r.models[r.models.length - 1].id).toBe('poolside/laguna-m.1:free');
    expect(r.models[r.models.length - 1].error).toMatch(/no endpoints/);
  });

  it('a rate-limited probe retries once, then reports "unknown" rather than a failure', async () => {
    mockLlm.complete
      .mockRejectedValueOnce(new LlmError('429', 'rate_limit', 'z-ai/glm-5.2:free', 10))
      .mockRejectedValueOnce(new LlmError('429', 'rate_limit', 'z-ai/glm-5.2:free', 10));
    const r = await service.probe('z-ai/glm-5.2:free');
    expect(r.status).toBe('unknown');
    expect(mockLlm.complete).toHaveBeenCalledTimes(2);
    expect(mockRepo.upsert).not.toHaveBeenCalled();

    mockLlm.complete
      .mockRejectedValueOnce(new LlmError('429', 'rate_limit', 'z-ai/glm-5.2:free', 10))
      .mockResolvedValueOnce({ text: 'ok', provider: 'openrouter', model: 'z-ai/glm-5.2:free' });
    expect((await service.probe('z-ai/glm-5.2:free')).status).toBe('ok');
  });

  it('fallbackCandidates: freshest verified first, then unverified, never the broken ones', async () => {
    rows.push(
      { model: 'google/gemma-4-31b-it:free', ok: true, error: null, latencyMs: 900, checkedAt: new Date(Date.now() - 3600_000) },
      { model: 'z-ai/glm-5.2:free', ok: true, error: null, latencyMs: 700, checkedAt: new Date() },
      { model: 'retired/model:free', ok: true, error: null, latencyMs: 1, checkedAt: new Date() }, // not in the list any more
    );
    expect(await service.fallbackCandidates('poolside/laguna-m.1:free')).toEqual(['z-ai/glm-5.2:free', 'google/gemma-4-31b-it:free']);
    rows.push({ model: 'google/gemma-4-31b-it:free', ok: false, error: '404', latencyMs: null, checkedAt: new Date() });
    rows.splice(0, 1);
    expect(await service.fallbackCandidates('z-ai/glm-5.2:free')).toEqual([]);
  });

  it('fallbackCandidates offers unverified models when nothing is verified yet, ignoring stale checks', async () => {
    rows.push({ model: 'z-ai/glm-5.2:free', ok: false, error: '404', latencyMs: null, checkedAt: new Date(Date.now() - 3 * 86400_000) });
    const c = await service.fallbackCandidates('poolside/laguna-m.1:free');
    expect(c).toEqual(['z-ai/glm-5.2:free', 'google/gemma-4-31b-it:free']);
  });
});
