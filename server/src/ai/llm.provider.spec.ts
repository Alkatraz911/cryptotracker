import { LlmError, LlmProvider } from './llm.provider';

// Exercises the OpenAI-compatible path against a fake fetch: the error
// classification is what the model picker and the analyze fallback key on.
describe('LlmProvider (openrouter error classification)', () => {
  const p = new LlmProvider();
  const env = { ...process.env };
  const fetchMock = jest.fn();

  beforeEach(() => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'k';
    process.env.AI_MODEL = 'dead/model:free';
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    fetchMock.mockReset();
  });
  afterAll(() => { process.env = env; });

  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    ok: status < 400, status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body), json: async () => body,
  });
  const fail = async (): Promise<LlmError> => {
    try { await p.complete({ system: 's', prompt: 'p' }); throw new Error('expected failure'); }
    catch (e) { return e as LlmError; }
  };

  it('uses the requested model over AI_MODEL', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { choices: [{ message: { content: 'hi' } }] }));
    const r = await p.complete({ system: 's', prompt: 'p', model: 'z-ai/glm-5.2:free' });
    expect(r.model).toBe('z-ai/glm-5.2:free');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('z-ai/glm-5.2:free');
  });

  it('404 "No endpoints" and 403 policy gates are model_unavailable', async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { error: { message: 'No endpoints found for dead/model:free.', code: 404 } }));
    expect((await fail()).kind).toBe('model_unavailable');
    fetchMock.mockResolvedValueOnce(reply(403, { error: { message: 'only available on agentic harnesses', code: 403 } }));
    const e = await fail();
    expect(e.kind).toBe('model_unavailable');
    expect(e.message).toMatch(/agentic/);
  });

  it('429 is rate_limit and carries the retry hint', async () => {
    fetchMock.mockResolvedValueOnce(reply(429, { error: { message: 'rate-limited upstream', code: 429, metadata: { retry_after_seconds: 5 } } }));
    const e = await fail();
    expect(e.kind).toBe('rate_limit');
    expect(e.retryAfterMs).toBe(5000);
  });

  it('401 / 402 are auth / quota (not worth switching models)', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, {}));
    expect((await fail()).kind).toBe('auth');
    fetchMock.mockResolvedValueOnce(reply(402, {}));
    expect((await fail()).kind).toBe('quota');
  });

  it('lists ids from /models/user, marking zero-priced ones free', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { data: [
      { id: 'a/b:free', name: 'B', pricing: { prompt: '0', completion: '0' }, context_length: 8000 },
      { id: 'c/d', name: 'D', pricing: { prompt: '0.001', completion: '0.002' } },
    ] }));
    const m = await p.listModels();
    expect(m.map((x) => [x.id, x.free])).toEqual([['a/b:free', true], ['c/d', false]]);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/models\/user$/);
  });
});
