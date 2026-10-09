import { ProviderError, badResponse } from '../errors';
import { httpJson } from '../http';
import { REASONING_TOKEN_FLOOR, type ILLMProvider, type ModelListing, type ProviderContext, type ProviderRequest, type ProviderResponse } from './types';

const WHO = 'Google Gemini';
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

type ContentPart = { type: string; text?: string; data?: string; mime_type?: string };

export interface InteractionReply {
  model?: string;
  status?: string;
  steps?: { type?: string; content?: ContentPart[] }[];
  outputs?: ContentPart[];
  output_text?: string;
  usage?: { total_input_tokens?: number; total_output_tokens?: number; total_cached_tokens?: number };
  errors?: { code?: string; message?: string }[];
}

/** All content parts the model produced, across the response shapes the API has used. */
export function interactionParts(reply: InteractionReply): ContentPart[] {
  const fromSteps = (reply.steps ?? []).filter((s) => !s.type || s.type === 'model_output').flatMap((s) => s.content ?? []);
  return [...fromSteps, ...(reply.outputs ?? [])];
}

/** Gemini via the Interactions API. */
export class GoogleProvider implements ILLMProvider {
  readonly id = 'google' as const;
  readonly displayName = WHO;
  private noTemperature = new Set<string>();

  async complete(ctx: ProviderContext, req: ProviderRequest): Promise<ProviderResponse> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'No Gemini API key is configured.');
    // The Interactions API takes a flat list of content; earlier turns are labelled in text.
    const input: ContentPart[] = [];
    for (const m of req.messages) {
      if (m.role === 'assistant') {
        input.push({ type: 'text', text: `(Your previous reply was:)\n${m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n')}` });
        continue;
      }
      for (const p of m.content) {
        input.push(p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image', data: p.image.base64, mime_type: p.image.mimeType });
      }
    }
    const generation: Record<string, unknown> = { max_output_tokens: Math.max(req.maxTokens, REASONING_TOKEN_FLOOR) };
    if (req.effort) generation.thinking_level = req.effort;
    if (req.temperature !== undefined && !this.noTemperature.has(ctx.model)) generation.temperature = req.temperature;
    const body: Record<string, unknown> = {
      model: ctx.model,
      input,
      system_instruction: req.system,
      generation_config: generation,
      store: false,
      ...(req.json ? { response_format: { type: 'text', mime_type: 'application/json' } } : {}),
    };

    let reply: InteractionReply;
    try {
      reply = await this.post(ctx, body);
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'bad_request' && /temperature/i.test(err.detail ?? '') && generation.temperature !== undefined) {
        this.noTemperature.add(ctx.model);
        delete generation.temperature;
        reply = await this.post(ctx, body);
      } else {
        throw err;
      }
    }
    if (reply.errors?.length) {
      const msg = reply.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
      if (/safety|block|prohibit/i.test(msg)) throw new ProviderError('moderation', `${WHO} blocked this request for safety reasons.`, msg);
      throw badResponse(WHO, msg);
    }
    const text = interactionParts(reply)
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('') || reply.output_text || '';
    if (!text) throw badResponse(WHO, `Empty reply, status=${reply.status}`);
    return {
      text,
      model: reply.model ?? ctx.model,
      usage: {
        inputTokens: reply.usage?.total_input_tokens,
        outputTokens: reply.usage?.total_output_tokens,
        cachedInputTokens: reply.usage?.total_cached_tokens,
      },
    };
  }

  private post(ctx: ProviderContext, body: Record<string, unknown>): Promise<InteractionReply> {
    return httpJson<InteractionReply>(
      `${GEMINI_BASE}/interactions`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': ctx.apiKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { who: WHO, signal: ctx.signal, timeoutMs: 120_000 },
    );
  }

  async listModels(ctx: ProviderContext): Promise<ModelListing[]> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'No Gemini API key is configured.');
    const reply = await httpJson<{ models?: { name: string; displayName?: string }[] }>(
      `${GEMINI_BASE}/models?pageSize=200`,
      { headers: { 'x-goog-api-key': ctx.apiKey } },
      { who: WHO, signal: ctx.signal, timeoutMs: 20_000, retries: 1 },
    );
    return (reply.models ?? [])
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }))
      .filter((m) => /gemini/.test(m.id) && !/image|embedding|tts|audio|live/.test(m.id));
  }
}
