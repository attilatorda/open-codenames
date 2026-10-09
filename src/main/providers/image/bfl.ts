import { ProviderError, badResponse } from '../errors';
import { httpJson, httpRequest } from '../http';
import { sniffMime, type GeneratedImage, type IImageGenerationProvider, type ImageContext, type ImageRequest } from './types';

const WHO = 'Black Forest Labs';
const BASE = 'https://api.bfl.ai/v1';
const POLL_MS = 1000;
const MAX_WAIT_MS = 150_000;

interface PollReply {
  status?: string;
  result?: { sample?: string };
  details?: unknown;
}

export class BflProvider implements IImageGenerationProvider {
  readonly id = 'bfl' as const;
  readonly displayName = WHO;

  async generate(ctx: ImageContext, req: ImageRequest): Promise<GeneratedImage> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'No Black Forest Labs API key is configured.');
    const headers = { 'x-key': ctx.apiKey, accept: 'application/json', 'Content-Type': 'application/json' };
    const start = await httpJson<{ id?: string; polling_url?: string }>(
      `${BASE}/${encodeURIComponent(ctx.model || 'flux-2-pro')}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: req.prompt,
          width: 1024,
          height: 1024,
          output_format: 'jpeg',
          ...(req.seed !== undefined ? { seed: req.seed % 2147483647 } : {}),
        }),
      },
      { who: WHO, signal: ctx.signal, timeoutMs: 30_000 },
    );
    const pollUrl = start.polling_url ?? (start.id ? `${BASE}/get_result?id=${encodeURIComponent(start.id)}` : undefined);
    if (!pollUrl) throw badResponse(WHO, 'No polling URL in reply');

    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (ctx.signal?.aborted) throw new ProviderError('aborted', 'Cancelled.');
      const poll = await httpJson<PollReply>(pollUrl, { headers }, { who: WHO, signal: ctx.signal, timeoutMs: 20_000 });
      const status = poll.status ?? '';
      if (status === 'Ready' && poll.result?.sample) {
        const res = await httpRequest(poll.result.sample, {}, { who: WHO, signal: ctx.signal, timeoutMs: 60_000 });
        const bytes = Buffer.from(await res.arrayBuffer());
        return { bytes, mime: sniffMime(bytes, 'image/jpeg') };
      }
      if (/moderated/i.test(status)) throw new ProviderError('moderation', `${WHO} moderated this prompt.`, status);
      if (/error|failed|not found/i.test(status)) throw new ProviderError('server', `${WHO} could not generate this image.`, `${status} ${JSON.stringify(poll.details ?? '')}`, undefined, true);
    }
    throw new ProviderError('timeout', `${WHO} took too long to generate an image.`, undefined, undefined, true);
  }

  async test(ctx: ImageContext): Promise<string> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'Enter a Black Forest Labs API key first.');
    try {
      const reply = await httpJson<{ credits?: number }>(
        `${BASE}/credits`,
        { headers: { 'x-key': ctx.apiKey, accept: 'application/json' } },
        { who: WHO, signal: ctx.signal, timeoutMs: 20_000, retries: 1 },
      );
      return typeof reply.credits === 'number' ? `Connected — ${reply.credits} credits available.` : 'Connected — key accepted.';
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'not_found') {
        return 'The key could not be checked in advance; it will be verified when the first image is generated.';
      }
      throw err;
    }
  }
}
