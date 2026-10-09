import type { LLMProviderId } from '@shared/providers';
import { ProviderError, badResponse } from '../errors';
import { httpJson, stripTrailingSlash } from '../http';
import type { ILLMProvider, ModelListing, ProviderContext, ProviderRequest, ProviderResponse } from './types';

interface ChatReply {
  model?: string;
  choices?: { message?: { content?: string | { type: string; text?: string }[]; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string };
}

export interface CompatOptions {
  id: LLMProviderId;
  displayName: string;
  defaultBaseUrl: string;
  local?: boolean;
  extraHeaders?: Record<string, string>;
  /** Endpoint that validates a key when /models is public (OpenRouter). */
  keyCheckPath?: string;
}

/**
 * Chat Completions-compatible servers: OpenRouter, xAI, Mistral, DeepSeek, Ollama, LM Studio…
 * Optional fields a server rejects are dropped on retry and remembered per model.
 */
export class OpenAICompatibleProvider implements ILLMProvider {
  readonly id: LLMProviderId;
  readonly displayName: string;
  private unsupported = new Map<string, Set<'response_format' | 'temperature'>>();

  constructor(private readonly opts: CompatOptions) {
    this.id = opts.id;
    this.displayName = opts.displayName;
  }

  private base(ctx: ProviderContext): string {
    return stripTrailingSlash(ctx.baseUrl || this.opts.defaultBaseUrl);
  }

  private headers(ctx: ProviderContext): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(ctx.apiKey ? { Authorization: `Bearer ${ctx.apiKey}` } : {}),
      ...this.opts.extraHeaders,
    };
  }

  async complete(ctx: ProviderContext, req: ProviderRequest): Promise<ProviderResponse> {
    if (!ctx.apiKey && !this.opts.local) throw new ProviderError('not_configured', `No ${this.displayName} API key is configured.`);
    if (!ctx.model) throw new ProviderError('not_configured', `Choose a ${this.displayName} model in AI Configuration.`);
    const skip = this.unsupported.get(ctx.model) ?? new Set();
    for (let attempt = 0; attempt < 3; attempt++) {
      const body: Record<string, unknown> = {
        model: ctx.model,
        messages: [
          { role: 'system', content: req.system },
          ...req.messages.map((m) => ({
            role: m.role,
            content:
              m.content.every((p) => p.type === 'text')
                ? m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n')
                : m.content.map((p) =>
                    p.type === 'text'
                      ? { type: 'text', text: p.text }
                      : { type: 'image_url', image_url: { url: `data:${p.image.mimeType};base64,${p.image.base64}`, detail: 'low' } },
                  ),
          })),
        ],
        max_tokens: req.maxTokens < 4000 ? 4000 : req.maxTokens,
        stream: false,
      };
      if (req.temperature !== undefined && !skip.has('temperature')) body.temperature = req.temperature;
      if (req.json && !skip.has('response_format')) body.response_format = { type: 'json_object' };

      try {
        const reply = await httpJson<ChatReply>(
          `${this.base(ctx)}/chat/completions`,
          { method: 'POST', headers: this.headers(ctx), body: JSON.stringify(body) },
          { who: this.displayName, signal: ctx.signal, timeoutMs: this.opts.local ? 300_000 : 120_000, local: this.opts.local },
        );
        return this.parse(reply, ctx.model);
      } catch (err) {
        if (!(err instanceof ProviderError) || err.kind !== 'bad_request') throw err;
        const d = (err.detail ?? '').toLowerCase();
        if (body.response_format && /response_format|json/.test(d)) skip.add('response_format');
        else if (body.temperature !== undefined && /temperature/.test(d)) skip.add('temperature');
        else throw err;
        this.unsupported.set(ctx.model, skip);
      }
    }
    throw new ProviderError('bad_request', `${this.displayName} rejected the request for this model.`);
  }

  private parse(reply: ChatReply, model: string): ProviderResponse {
    const choice = reply.choices?.[0];
    if (!choice) throw badResponse(this.displayName, reply.error?.message ?? 'No choices in reply');
    if (choice.message?.refusal) throw new ProviderError('moderation', `${this.displayName} declined this request.`, choice.message.refusal);
    const content = choice.message?.content;
    const text = typeof content === 'string' ? content : (content ?? []).map((c) => c.text ?? '').join('');
    if (!text) throw badResponse(this.displayName, `Empty reply (finish_reason=${choice.finish_reason})`);
    if (choice.finish_reason === 'content_filter') {
      throw new ProviderError('moderation', `${this.displayName} filtered this response.`, 'finish_reason=content_filter');
    }
    return {
      text,
      model: reply.model ?? model,
      usage: {
        inputTokens: reply.usage?.prompt_tokens,
        outputTokens: reply.usage?.completion_tokens,
        cachedInputTokens: reply.usage?.prompt_tokens_details?.cached_tokens,
      },
    };
  }

  async listModels(ctx: ProviderContext): Promise<ModelListing[]> {
    if (!ctx.apiKey && !this.opts.local) throw new ProviderError('not_configured', `No ${this.displayName} API key is configured.`);
    const opts = { who: this.displayName, signal: ctx.signal, timeoutMs: 20_000, retries: 1, local: this.opts.local };
    if (this.opts.keyCheckPath) {
      // OpenRouter's model list is public, so validate the key separately first.
      await httpJson(`${this.base(ctx)}${this.opts.keyCheckPath}`, { headers: this.headers(ctx) }, opts);
    }
    const reply = await httpJson<{ data?: { id: string; name?: string }[]; models?: { name: string }[] }>(
      `${this.base(ctx)}/models`,
      { headers: this.headers(ctx) },
      opts,
    );
    const list = reply.data ?? reply.models?.map((m) => ({ id: m.name, name: m.name })) ?? [];
    return list
      .filter((m) => !/embed|whisper|tts|moderation|rerank/i.test(m.id))
      .map((m) => ({ id: m.id, label: m.name || m.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}
