import { ProviderError, badResponse } from '../errors';
import { httpJson, httpRequest } from '../http';
import { sniffMime, type GeneratedImage, type IImageGenerationProvider, type ImageContext, type ImageRequest } from './types';

const WHO = 'Replicate';
const BASE = 'https://api.replicate.com/v1';

interface Prediction {
  status?: string;
  output?: string | string[] | null;
  error?: string | null;
  urls?: { get?: string };
}

export class ReplicateProvider implements IImageGenerationProvider {
  readonly id = 'replicate' as const;
  readonly displayName = WHO;

  async generate(ctx: ImageContext, req: ImageRequest): Promise<GeneratedImage> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'No Replicate API token is configured.');
    const model = ctx.model || 'black-forest-labs/flux-schnell';
    if (!/^[\w.-]+\/[\w.-]+$/.test(model)) {
      throw new ProviderError('not_configured', 'Replicate models must look like "owner/model-name".');
    }
    const headers = { Authorization: `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' };
    let pred = await httpJson<Prediction>(
      `${BASE}/models/${model}/predictions`,
      {
        method: 'POST',
        headers: { ...headers, Prefer: 'wait=60' },
        body: JSON.stringify({
          input: {
            prompt: req.prompt,
            aspect_ratio: '1:1',
            output_format: 'jpg',
            ...(req.seed !== undefined ? { seed: req.seed % 2147483647 } : {}),
          },
        }),
      },
      { who: WHO, signal: ctx.signal, timeoutMs: 90_000 },
    );
    const deadline = Date.now() + 120_000;
    while ((pred.status === 'starting' || pred.status === 'processing') && pred.urls?.get && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      pred = await httpJson<Prediction>(pred.urls.get, { headers }, { who: WHO, signal: ctx.signal, timeoutMs: 20_000 });
    }
    if (pred.status === 'failed' || pred.error) {
      const msg = pred.error ?? 'failed';
      if (/nsfw|safety|moderat/i.test(msg)) throw new ProviderError('moderation', `${WHO} flagged this prompt.`, msg);
      throw new ProviderError('server', `${WHO} could not generate this image.`, msg, undefined, true);
    }
    const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    if (!url) throw badResponse(WHO, `No output (status=${pred.status})`);
    const res = await httpRequest(url, {}, { who: WHO, signal: ctx.signal, timeoutMs: 60_000 });
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, mime: sniffMime(bytes, 'image/jpeg') };
  }

  async test(ctx: ImageContext): Promise<string> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'Enter a Replicate API token first.');
    const acct = await httpJson<{ username?: string }>(
      `${BASE}/account`,
      { headers: { Authorization: `Bearer ${ctx.apiKey}` } },
      { who: WHO, signal: ctx.signal, timeoutMs: 20_000, retries: 1 },
    );
    return acct.username ? `Connected as ${acct.username}.` : 'Connected.';
  }
}
