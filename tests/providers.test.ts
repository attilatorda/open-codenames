import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, classifyHttpError } from '../src/main/providers/errors';
import { httpJson } from '../src/main/providers/http';
import { OpenAIProvider } from '../src/main/providers/llm/openai';
import { OpenAICompatibleProvider } from '../src/main/providers/llm/openaiCompatible';
import { GoogleProvider } from '../src/main/providers/llm/google';
import { AnthropicProvider } from '../src/main/providers/llm/anthropic';
import { StabilityProvider } from '../src/main/providers/image/stability';
import type { ProviderRequest } from '../src/main/providers/llm/types';

type Call = { url: string; init: RequestInit };

function mockFetch(responses: (Response | (() => Response))[]): Call[] {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url instanceof Request ? url.url : url), init: init ?? {} });
      const r = responses[Math.min(i++, responses.length - 1)];
      return typeof r === 'function' ? r() : r.clone();
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const body = (c: Call) => JSON.parse(String(c.init.body));

const REQ: ProviderRequest = {
  system: 'You are a test.',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Picture A1:' },
        { type: 'image', image: { mimeType: 'image/jpeg', base64: 'QUJD' } },
        { type: 'text', text: 'Reply with JSON.' },
      ],
    },
  ],
  maxTokens: 900,
  temperature: 0.7,
  json: true,
  effort: 'low',
  cacheImages: true,
};

afterEach(() => vi.unstubAllGlobals());

describe('error classification', () => {
  it.each([
    [401, '{}', 'auth', false],
    [402, 'payment required', 'quota', false],
    [403, '{"name":"content_moderation"}', 'moderation', false],
    [404, 'model not found', 'not_found', false],
    [429, 'slow down', 'rate_limit', true],
    [429, '{"error":{"code":"insufficient_quota"}}', 'quota', false],
    [400, '{"error":{"code":"moderation_blocked"}}', 'moderation', false],
    [400, 'bad field', 'bad_request', false],
    [500, 'oops', 'server', true],
    [529, 'overloaded', 'server', true],
  ])('HTTP %d %s → %s', (status, text, kind, retryable) => {
    const e = classifyHttpError('Acme', status, text);
    expect(e.kind).toBe(kind);
    expect(e.retryable).toBe(retryable);
    expect(e.friendly).not.toMatch(/HTTP|\d{3}/);
  });

  it('retries rate limits and then succeeds', async () => {
    const calls = mockFetch([json({ error: 'slow' }, 429, { 'retry-after': '0' }), json({ ok: true })]);
    await expect(httpJson('https://x.test', {}, { who: 'Acme' })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('does not retry auth failures', async () => {
    const calls = mockFetch([json({ error: 'bad key' }, 401)]);
    await expect(httpJson('https://x.test', {}, { who: 'Acme' })).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toHaveLength(1);
  });

  it('reports network failures in friendly terms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(httpJson('https://x.test', {}, { who: 'Acme', retries: 0 })).rejects.toMatchObject({
      kind: 'network',
      friendly: 'Could not reach Acme. Check your internet connection.',
    });
  });
});

describe('OpenAI (Responses API)', () => {
  it('builds the request and reads output_text', async () => {
    const calls = mockFetch([
      json({ model: 'gpt-6.1-sol', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }], usage: { input_tokens: 10, output_tokens: 5 } }),
    ]);
    const res = await new OpenAIProvider().complete({ apiKey: 'sk-test', model: 'gpt-6.1-sol' }, REQ);
    expect(res.text).toBe('{"a":1}');
    const b = body(calls[0]);
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses');
    expect(b.instructions).toBe('You are a test.');
    expect(b.store).toBe(false);
    expect(b.reasoning).toEqual({ effort: 'low' });
    expect(b.text).toEqual({ format: { type: 'json_object' } });
    expect(b.input[0].content[1]).toEqual({ type: 'input_image', image_url: 'data:image/jpeg;base64,QUJD', detail: 'low' });
    expect(b.max_output_tokens).toBeGreaterThanOrEqual(16000);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('drops reasoning for models that reject it and remembers', async () => {
    const calls = mockFetch([
      json({ error: { message: "Unsupported parameter: 'reasoning.effort' is not supported with this model." } }, 400),
      json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }),
    ]);
    const p = new OpenAIProvider();
    await p.complete({ apiKey: 'k', model: 'old-model' }, REQ);
    expect(body(calls[1]).reasoning).toBeUndefined();
    expect(body(calls[1]).temperature).toBe(0.7);
  });

  it('turns a refusal into a moderation error', async () => {
    mockFetch([json({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] })]);
    await expect(new OpenAIProvider().complete({ apiKey: 'k', model: 'm' }, REQ)).rejects.toMatchObject({ kind: 'moderation' });
  });
});

describe('OpenAI-compatible (OpenRouter, Ollama, …)', () => {
  const provider = () => new OpenAICompatibleProvider({ id: 'local', displayName: 'Local LLM', defaultBaseUrl: 'http://localhost:11434/v1/', local: true });

  it('sends chat completions with image_url parts', async () => {
    const calls = mockFetch([json({ choices: [{ message: { content: '{"x":1}' }, finish_reason: 'stop' }] })]);
    const res = await provider().complete({ model: 'llava' }, REQ);
    expect(res.text).toBe('{"x":1}');
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions');
    const b = body(calls[0]);
    expect(b.messages[0]).toEqual({ role: 'system', content: 'You are a test.' });
    expect(b.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD', detail: 'low' } });
    expect(b.response_format).toEqual({ type: 'json_object' });
  });

  it('retries without response_format when the server rejects it', async () => {
    const calls = mockFetch([
      json({ error: { message: 'response_format is not supported' } }, 400),
      json({ choices: [{ message: { content: 'ok' } }] }),
    ]);
    await provider().complete({ model: 'tiny' }, REQ);
    expect(body(calls[1]).response_format).toBeUndefined();
  });

  it('explains when the local server is not running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))));
    await expect(provider().complete({ model: 'x' }, REQ)).rejects.toMatchObject({ kind: 'network', friendly: expect.stringMatching(/local server.*running/) });
  });
});

describe('Google Gemini (Interactions API)', () => {
  it('builds the request and reads steps content', async () => {
    const calls = mockFetch([
      json({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"g":1}' }] }], usage: { total_input_tokens: 3, total_output_tokens: 2 } }),
    ]);
    const res = await new GoogleProvider().complete({ apiKey: 'AIzaTest', model: 'gemini-3.8-flash' }, REQ);
    expect(res.text).toBe('{"g":1}');
    expect(res.usage).toMatchObject({ inputTokens: 3, outputTokens: 2 });
    const b = body(calls[0]);
    expect(calls[0].url).toMatch(/\/v1beta\/interactions$/);
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaTest');
    expect(b.system_instruction).toBe('You are a test.');
    expect(b.input[1]).toEqual({ type: 'image', data: 'QUJD', mime_type: 'image/jpeg' });
    expect(b.generation_config.thinking_level).toBe('low');
    expect(b.response_format).toEqual({ type: 'text', mime_type: 'application/json' });
    expect(b.store).toBe(false);
  });

  it('also understands the flat outputs shape', async () => {
    mockFetch([json({ outputs: [{ type: 'text', text: 'hello' }] })]);
    const res = await new GoogleProvider().complete({ apiKey: 'k', model: 'm' }, REQ);
    expect(res.text).toBe('hello');
  });
});

describe('Anthropic (official SDK)', () => {
  const reply = (extra: Record<string, unknown> = {}) =>
    json({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: '{"c":1}' }],
      stop_reason: 'end_turn',
      stop_details: null,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80 },
      ...extra,
    });

  it('caches the board images, omits temperature on current models and opts into fallbacks', async () => {
    const calls = mockFetch([reply()]);
    const res = await new AnthropicProvider().complete({ apiKey: 'sk-ant-test', model: 'claude-opus-5-5' }, REQ);
    expect(res.text).toBe('{"c":1}');
    expect(res.usage?.cachedInputTokens).toBe(80);
    const b = body(calls[0]);
    expect(calls[0].url).toMatch(/\/v1\/messages/);
    expect(b.temperature).toBeUndefined();
    expect(b.output_config).toEqual({ effort: 'low' });
    expect(b.fallbacks).toBe('default');
    expect(b.max_tokens).toBeGreaterThanOrEqual(16000);
    const content = b.messages[0].content;
    expect(content[1]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' }, cache_control: { type: 'ephemeral' } });
    expect(content[2].cache_control).toBeUndefined();
    const headers = new Headers(calls[0].init.headers as ConstructorParameters<typeof Headers>[0]);
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(headers.get('x-api-key')).toBe('sk-ant-test');
  });

  it('keeps temperature for models that accept it and skips effort on Haiku', async () => {
    const calls = mockFetch([reply({ model: 'claude-haiku-4-5' })]);
    await new AnthropicProvider().complete({ apiKey: 'k', model: 'claude-haiku-4-5' }, REQ);
    const b = body(calls[0]);
    expect(b.temperature).toBe(0.7);
    expect(b.output_config).toBeUndefined();
    expect(b.fallbacks).toBeUndefined();
  });

  it('maps refusals to moderation errors', async () => {
    mockFetch([reply({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } })]);
    await expect(new AnthropicProvider().complete({ apiKey: 'k', model: 'claude-sonnet-5-5' }, REQ)).rejects.toMatchObject({ kind: 'moderation' });
  });

  it('maps authentication errors', async () => {
    mockFetch([json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401)]);
    await expect(new AnthropicProvider().complete({ apiKey: 'bad', model: 'claude-opus-5-5' }, REQ)).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('Stability AI', () => {
  it('treats 403 and CONTENT_FILTERED as moderation', async () => {
    mockFetch([json({ name: 'content_moderation' }, 403)]);
    await expect(new StabilityProvider().generate({ apiKey: 'k', model: 'core', quality: 'low' }, { prompt: 'p', negativePrompt: 'n' })).rejects.toMatchObject({ kind: 'moderation' });
    mockFetch([json({ finish_reason: 'CONTENT_FILTERED', image: '' })]);
    await expect(new StabilityProvider().generate({ apiKey: 'k', model: 'core', quality: 'low' }, { prompt: 'p', negativePrompt: 'n' })).rejects.toMatchObject({ kind: 'moderation' });
  });

  it('posts multipart form data to the right endpoint', async () => {
    const calls = mockFetch([json({ finish_reason: 'SUCCESS', image: Buffer.from('img').toString('base64') })]);
    const img = await new StabilityProvider().generate({ apiKey: 'k', model: 'sd3.5-large-turbo', quality: 'low' }, { prompt: 'a fox', negativePrompt: 'text' });
    expect(img.bytes.toString()).toBe('img');
    expect(calls[0].url).toBe('https://api.stability.ai/v2beta/stable-image/generate/sd3');
    const form = calls[0].init.body as FormData;
    expect(form.get('model')).toBe('sd3.5-large-turbo');
    expect(form.get('negative_prompt')).toBeNull();
    expect(form.get('aspect_ratio')).toBe('1:1');
  });
});

describe('ProviderError', () => {
  it('serializes to a friendly error without leaking internals into the message', () => {
    const e = new ProviderError('rate_limit', 'Busy.', 'HTTP 429: …');
    expect(e.toFriendly()).toEqual({ kind: 'rate_limit', message: 'Busy.', detail: 'HTTP 429: …' });
  });
});
