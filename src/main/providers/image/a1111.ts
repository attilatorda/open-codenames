import { ProviderError, badResponse } from '../errors';
import { httpJson, stripTrailingSlash } from '../http';
import { sniffMime, type GeneratedImage, type IImageGenerationProvider, type ImageContext, type ImageRequest } from './types';

const WHO = 'Local Stable Diffusion';
const STEPS = { low: 18, medium: 26, high: 36 } as const;

/** AUTOMATIC1111 / Forge web UI API (start it with --api). */
export class A1111Provider implements IImageGenerationProvider {
  readonly id = 'local-a1111' as const;
  readonly displayName = WHO;
  readonly local = true;

  private base(ctx: ImageContext): string {
    return stripTrailingSlash(ctx.baseUrl || 'http://127.0.0.1:7860');
  }

  async generate(ctx: ImageContext, req: ImageRequest): Promise<GeneratedImage> {
    const reply = await httpJson<{ images?: string[] }>(
      `${this.base(ctx)}/sdapi/v1/txt2img`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: req.prompt,
          negative_prompt: req.negativePrompt,
          width: 512,
          height: 512,
          steps: STEPS[ctx.quality],
          cfg_scale: 6.5,
          seed: req.seed !== undefined ? req.seed % 2147483647 : -1,
        }),
      },
      { who: WHO, signal: ctx.signal, timeoutMs: 300_000, local: true, retries: 0 },
    );
    const b64 = reply.images?.[0];
    if (!b64) throw badResponse(WHO, 'No image in reply');
    const bytes = Buffer.from(b64, 'base64');
    return { bytes, mime: sniffMime(bytes) };
  }

  async test(ctx: ImageContext): Promise<string> {
    const models = await httpJson<{ title?: string }[]>(
      `${this.base(ctx)}/sdapi/v1/sd-models`,
      {},
      { who: WHO, signal: ctx.signal, timeoutMs: 10_000, local: true, retries: 0 },
    );
    if (!Array.isArray(models)) throw new ProviderError('bad_response', 'Unexpected reply from the local server.');
    return `Connected — ${models.length} model${models.length === 1 ? '' : 's'} installed.`;
  }
}
