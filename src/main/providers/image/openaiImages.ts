import { ProviderError, badResponse } from '../errors';
import { httpJson } from '../http';
import type { GeneratedImage, IImageGenerationProvider, ImageContext, ImageRequest } from './types';

const WHO = 'OpenAI';
const BASE = 'https://api.openai.com/v1';

export class OpenAIImageProvider implements IImageGenerationProvider {
  readonly id = 'openai' as const;
  readonly displayName = WHO;

  async generate(ctx: ImageContext, req: ImageRequest): Promise<GeneratedImage> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'No OpenAI API key is configured.');
    const reply = await httpJson<{ data?: { b64_json?: string }[] }>(
      `${BASE}/images/generations`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ctx.model || 'gpt-image-2.5-flare',
          prompt: req.prompt,
          size: '1024x1024',
          quality: ctx.quality,
          output_format: 'jpeg',
          output_compression: 85,
          n: 1,
        }),
      },
      { who: WHO, signal: ctx.signal, timeoutMs: 180_000 },
    );
    const b64 = reply.data?.[0]?.b64_json;
    if (!b64) throw badResponse(WHO, 'No image data in reply');
    return { bytes: Buffer.from(b64, 'base64'), mime: 'image/jpeg' };
  }

  async test(ctx: ImageContext): Promise<string> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'Enter an OpenAI API key first.');
    await httpJson(`${BASE}/models`, { headers: { Authorization: `Bearer ${ctx.apiKey}` } }, { who: WHO, signal: ctx.signal, timeoutMs: 20_000, retries: 1 });
    return 'Connected — key accepted.';
  }
}
