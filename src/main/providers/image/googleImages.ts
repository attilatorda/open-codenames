import { ProviderError, badResponse } from '../errors';
import { httpJson } from '../http';
import { GEMINI_BASE, interactionParts, type InteractionReply } from '../llm/google';
import type { GeneratedImage, IImageGenerationProvider, ImageContext, ImageRequest } from './types';

const WHO = 'Google';

export class GoogleImageProvider implements IImageGenerationProvider {
  readonly id = 'google' as const;
  readonly displayName = WHO;

  async generate(ctx: ImageContext, req: ImageRequest): Promise<GeneratedImage> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'No Google API key is configured.');
    const reply = await httpJson<InteractionReply>(
      `${GEMINI_BASE}/interactions`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': ctx.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ctx.model || 'gemini-nano-banana-2.1',
          input: [{ type: 'text', text: `${req.prompt}. Avoid: ${req.negativePrompt}.` }],
          response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '1:1', image_size: '1K' },
          store: false,
        }),
      },
      { who: WHO, signal: ctx.signal, timeoutMs: 180_000 },
    );
    const parts = interactionParts(reply);
    const image = parts.find((p) => p.type === 'image' && p.data);
    if (image?.data) return { bytes: Buffer.from(image.data, 'base64'), mime: image.mime_type || 'image/jpeg' };
    const errors = reply.errors?.map((e) => `${e.code}: ${e.message}`).join('; ');
    const text = parts.find((p) => p.type === 'text')?.text;
    if (errors && /safety|block|prohibit/i.test(errors)) throw new ProviderError('moderation', `${WHO} blocked this image prompt.`, errors);
    if (text) throw new ProviderError('moderation', `${WHO} answered with text instead of an image.`, text.slice(0, 300));
    throw badResponse(WHO, errors ?? `No image in reply (status=${reply.status})`);
  }

  async test(ctx: ImageContext): Promise<string> {
    if (!ctx.apiKey) throw new ProviderError('not_configured', 'Enter a Google API key first.');
    await httpJson(`${GEMINI_BASE}/models?pageSize=5`, { headers: { 'x-goog-api-key': ctx.apiKey } }, { who: WHO, signal: ctx.signal, timeoutMs: 20_000, retries: 1 });
    return 'Connected — key accepted.';
  }
}
