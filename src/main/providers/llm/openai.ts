import { ProviderError, badResponse } from '../errors';
import { httpJson } from '../http';
import { REASONING_TOKEN_FLOOR, type ILLMProvider, type ModelListing, type ProviderContext, type ProviderRequest, type ProviderResponse } from './types';

const WHO = 'OpenAI';
const BASE = 'https://api.openai.com/v1';

/** Optional request fields that some models reject; dropped (and remembered) on a 400 that names them. */
type Optional = 'reasoning' | 'temperature' | 'text';

interface ResponsesReply {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
}

/** OpenAI via the Responses API (the documented path for current GPT models). */
export class OpenAIProvider implements ILLMProvider {
  readonly id = 'openai' as const;
  readonly displayName = WHO;
  private unsupported = new Map<string, Set<Optional>>();

  async complete(ctx: ProviderContext, req: ProviderRequest): Promise<ProviderResponse> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'No OpenAI API key is configured.');
    const skip = this.unsupported.get(ctx.model) ?? new Set<Optional>();
    for (let attempt = 0; attempt < 3; attempt++) {
      const body: Record<string, unknown> = {
        model: ctx.model,
        instructions: req.system,
        input: req.messages.map((m) => ({
          role: m.role,
          content: m.content.map((p) =>
            p.type === 'text'
              ? { type: m.role === 'assistant' ? 'output_text' : 'input_text', text: p.text }
              : { type: 'input_image', image_url: `data:${p.image.mimeType};base64,${p.image.base64}`, detail: 'low' },
          ),
        })),
        max_output_tokens: Math.max(req.maxTokens, REASONING_TOKEN_FLOOR),
        store: false,
      };
      if (req.effort && !skip.has('reasoning')) body.reasoning = { effort: req.effort };
      if (req.temperature !== undefined && skip.has('reasoning') && !skip.has('temperature')) {
        // Non-reasoning models: personality temperature applies.
        body.temperature = req.temperature;
      }
      if (req.json && !skip.has('text')) body.text = { format: { type: 'json_object' } };

      try {
        const reply = await httpJson<ResponsesReply>(
          `${BASE}/responses`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
          { who: WHO, signal: ctx.signal, timeoutMs: 120_000 },
        );
        return parseReply(reply, ctx.model);
      } catch (err) {
        const dropped = droppedParam(err, body);
        if (!dropped) throw err;
        skip.add(dropped);
        this.unsupported.set(ctx.model, skip);
      }
    }
    throw new ProviderError('bad_request', `${WHO} rejected the request for this model.`);
  }

  async listModels(ctx: ProviderContext): Promise<ModelListing[]> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'No OpenAI API key is configured.');
    const reply = await httpJson<{ data: { id: string }[] }>(
      `${BASE}/models`,
      { headers: { Authorization: `Bearer ${ctx.apiKey}` } },
      { who: WHO, signal: ctx.signal, timeoutMs: 20_000, retries: 1 },
    );
    return reply.data
      .map((m) => m.id)
      .filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/image|audio|realtime|tts|transcribe|embedding|search|moderation|dall-e|whisper/.test(id))
      .sort()
      .map((id) => ({ id, label: id }));
  }
}

function parseReply(reply: ResponsesReply, model: string): ProviderResponse {
  const parts = (reply.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
  const refusal = parts.find((p) => p.type === 'refusal');
  if (refusal) {
    throw new ProviderError('moderation', `${WHO} declined this request.`, refusal.refusal ?? 'refusal');
  }
  const text = parts.filter((p) => p.type === 'output_text').map((p) => p.text ?? '').join('') || reply.output_text || '';
  if (!text) {
    const why = reply.incomplete_details?.reason ? ` (incomplete: ${reply.incomplete_details.reason})` : '';
    throw badResponse(WHO, `Empty reply, status=${reply.status}${why}`);
  }
  return {
    text,
    model: reply.model ?? model,
    usage: {
      inputTokens: reply.usage?.input_tokens,
      outputTokens: reply.usage?.output_tokens,
      cachedInputTokens: reply.usage?.input_tokens_details?.cached_tokens,
    },
  };
}

/** If a 400 complains about an optional field we sent, return which one so we can retry without it. */
export function droppedParam(err: unknown, body: Record<string, unknown>): Optional | undefined {
  if (!(err instanceof ProviderError) || err.kind !== 'bad_request' || !err.detail) return undefined;
  const d = err.detail.toLowerCase();
  if (body.reasoning && /reasoning/.test(d)) return 'reasoning';
  if (body.temperature !== undefined && /temperature/.test(d)) return 'temperature';
  if (body.text && /text\.format|json_object|response_format/.test(d)) return 'text';
  return undefined;
}
