import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, badResponse, classifyHttpError, classifyNetworkError } from '../errors';
import { REASONING_TOKEN_FLOOR, type ILLMProvider, type ModelListing, type ProviderContext, type ProviderRequest, type ProviderResponse } from './types';

const WHO = 'Anthropic';

/** Models that still accept sampling parameters (current models reject non-default temperature). */
function acceptsTemperature(model: string): boolean {
  return /haiku|claude-3|-4-[0-6]\b|-4-[0-6]-/.test(model);
}

/** `output_config.effort` is not available on Haiku 4.5 / Sonnet 4.5 and older. */
function acceptsEffort(model: string): boolean {
  return !/haiku|claude-3|sonnet-4-5|opus-4-1|opus-4-0|sonnet-4-0|-4-20/.test(model);
}

/** Models where we opt into server-side refusal fallbacks on the Claude API. */
function usesFallbacks(model: string): boolean {
  return /^claude-(opus-5|opus-5-5|sonnet-5-5|fable-5-1)$/.test(model);
}

export class AnthropicProvider implements ILLMProvider {
  readonly id = 'anthropic' as const;
  readonly displayName = WHO;
  /** Models for which the fallback beta was rejected; we stop sending it. */
  private noFallback = new Set<string>();

  /** `browser`: the web build calls the API straight from the page with the player's own key. */
  constructor(private readonly opts: { browser?: boolean } = {}) {}

  private client(ctx: ProviderContext): Anthropic {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'No Anthropic API key is configured.');
    return new Anthropic({ apiKey: ctx.apiKey, maxRetries: 2, timeout: 120_000, dangerouslyAllowBrowser: !!this.opts.browser });
  }

  async complete(ctx: ProviderContext, req: ProviderRequest): Promise<ProviderResponse> {
    const client = this.client(ctx);
    const lastImageIndex = new Map<number, number>();
    req.messages.forEach((m, mi) => {
      m.content.forEach((p, pi) => {
        if (p.type === 'image') lastImageIndex.set(mi, pi);
      });
    });
    const firstMessageWithImages = req.messages.findIndex((_, i) => lastImageIndex.has(i));

    const messages: Anthropic.Beta.BetaMessageParam[] = req.messages.map((m, mi) => ({
      role: m.role,
      content: m.content.map((p, pi): Anthropic.Beta.BetaContentBlockParam => {
        // Board pictures are a stable prefix: cache up to the last image of the first message.
        const cache =
          req.cacheImages && mi === firstMessageWithImages && lastImageIndex.get(mi) === pi
            ? { cache_control: { type: 'ephemeral' as const } }
            : {};
        if (p.type === 'text') return { type: 'text', text: p.text, ...cache };
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: p.image.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
            data: p.image.base64,
          },
          ...cache,
        };
      }),
    }));

    const model = ctx.model;
    const withFallback = usesFallbacks(model) && !this.noFallback.has(model);
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: Math.max(req.maxTokens, REASONING_TOKEN_FLOOR),
      system: req.system,
      messages,
      ...(acceptsTemperature(model) && req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(acceptsEffort(model) && req.effort ? { output_config: { effort: req.effort } } : {}),
      ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    };

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create(params, { signal: ctx.signal });
    } catch (err) {
      // If this account cannot use the fallback beta, retry once without it and remember.
      if (withFallback && err instanceof Anthropic.BadRequestError && /fallback|anthropic-beta/i.test(err.message)) {
        this.noFallback.add(model);
        const { betas: _b, fallbacks: _f, ...plain } = params;
        try {
          response = await client.beta.messages.create(plain, { signal: ctx.signal });
        } catch (err2) {
          throw mapError(err2, ctx.signal);
        }
      } else {
        throw mapError(err, ctx.signal);
      }
    }

    if (response.stop_reason === 'refusal') {
      throw new ProviderError(
        'moderation',
        'Claude declined this request (a safety classifier was triggered). Try again or use another model.',
        `stop_reason=refusal ${JSON.stringify(response.stop_details ?? null)}`,
      );
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!text) throw badResponse(WHO, `Empty reply (stop_reason=${response.stop_reason})`);
    return {
      text,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  }

  async listModels(ctx: ProviderContext): Promise<ModelListing[]> {
    const client = this.client(ctx);
    try {
      const out: ModelListing[] = [];
      for await (const m of client.models.list({ limit: 100 }, { signal: ctx.signal })) {
        out.push({ id: m.id, label: m.display_name || m.id });
      }
      return out;
    } catch (err) {
      throw mapError(err, ctx.signal);
    }
  }
}

function mapError(err: unknown, signal?: AbortSignal): ProviderError {
  if (err instanceof ProviderError) return err;
  if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) return new ProviderError('aborted', 'Cancelled.');
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError('timeout', `${WHO} took too long to answer.`, err.message, undefined, true);
  }
  if (err instanceof Anthropic.APIConnectionError) return classifyNetworkError(WHO, err);
  if (err instanceof Anthropic.APIError) {
    // 529 overloaded and other 5xx are retryable server problems.
    return classifyHttpError(WHO, err.status ?? 0, err.message);
  }
  return new ProviderError('unknown', `${WHO} request failed.`, (err as Error)?.message);
}
