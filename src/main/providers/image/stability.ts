import { ProviderError, badResponse, classifyHttpError } from '../errors';
import { httpJson } from '../http';
import type { GeneratedImage, IImageGenerationProvider, ImageContext, ImageRequest } from './types';

const WHO = 'Stability AI';
const BASE = 'https://api.stability.ai';

export class StabilityProvider implements IImageGenerationProvider {
  readonly id = 'stability' as const;
  readonly displayName = WHO;

  async generate(ctx: ImageContext, req: ImageRequest): Promise<GeneratedImage> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'No Stability AI API key is configured.');
    const model = ctx.model || 'core';
    const form = new FormData();
    form.set('prompt', req.prompt);
    form.set('aspect_ratio', '1:1');
    form.set('output_format', 'jpeg');
    if (req.seed !== undefined) form.set('seed', String(req.seed % 4294967294));
    let path: string;
    if (model === 'core' || model === 'ultra') {
      path = `/v2beta/stable-image/generate/${model}`;
      form.set('negative_prompt', req.negativePrompt);
    } else {
      path = '/v2beta/stable-image/generate/sd3';
      form.set('model', model);
      // Turbo/flash variants do not use negative prompts.
      if (!/turbo|flash/.test(model)) form.set('negative_prompt', req.negativePrompt);
    }
    const reply = await httpJson<{ image?: string; finish_reason?: string; errors?: string[] }>(
      `${BASE}${path}`,
      { method: 'POST', headers: { Authorization: `Bearer ${ctx.apiKey}`, Accept: 'application/json' }, body: form },
      {
        who: WHO,
        signal: ctx.signal,
        timeoutMs: 120_000,
        classify: (status, body) =>
          status === 403
            ? new ProviderError('moderation', `${WHO} flagged this prompt.`, `HTTP 403: ${body.slice(0, 300)}`, 403)
            : classifyHttpError(WHO, status, body),
      },
    );
    if (reply.finish_reason === 'CONTENT_FILTERED') {
      throw new ProviderError('moderation', `${WHO} filtered this image.`, 'finish_reason=CONTENT_FILTERED');
    }
    if (!reply.image) throw badResponse(WHO, JSON.stringify(reply).slice(0, 300));
    return { bytes: Buffer.from(reply.image, 'base64'), mime: 'image/jpeg' };
  }

  async test(ctx: ImageContext): Promise<string> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'Enter a Stability AI API key first.');
    const reply = await httpJson<{ credits?: number }>(
      `${BASE}/v1/user/balance`,
      { headers: { Authorization: `Bearer ${ctx.apiKey}` } },
      { who: WHO, signal: ctx.signal, timeoutMs: 20_000, retries: 1 },
    );
    return typeof reply.credits === 'number' ? `Connected — ${reply.credits.toFixed(1)} credits available.` : 'Connected.';
  }
}
