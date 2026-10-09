import type { GeneratedImage, IImageGenerationProvider, ImageContext, ImageRequest } from './types';

const MONO_PALETTES = [
  ['#f4f1ea', '#9a9a9a', '#1d1d1d'],
  ['#ffffff', '#6f6f6f', '#111111'],
  ['#efece4', '#bdbdbd', '#2b2b2b'],
];

const PALETTES = [
  ['#1b2a49', '#465881', '#f2a541'],
  ['#2d1e2f', '#6b2d5c', '#f0c987'],
  ['#0f3b3a', '#1f7a6f', '#ffd166'],
  ['#3a1c1c', '#a23e48', '#ffbf69'],
  ['#14213d', '#3d5a80', '#e0fbfc'],
  ['#2b2d42', '#8d99ae', '#ef233c'],
];

/** Developer-only placeholder art (debug builds only) for testing the generation pipeline: abstract shapes, no text. */
export class MockImageProvider implements IImageGenerationProvider {
  readonly id = 'mock' as const;
  readonly displayName = 'Mock images';

  async generate(_ctx: ImageContext, req: ImageRequest): Promise<GeneratedImage> {
    await new Promise((r) => setTimeout(r, 80 + Math.random() * 220));
    const mono = /^Monochrome/i.test(req.prompt);
    const concept = mono ? req.prompt.replace(/^.*?mashup:\s*/i, '').split('.')[0] : req.prompt.split(',')[0];
    let h = 2166136261;
    for (const ch of concept) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const [bg, mid, accent] = mono ? MONO_PALETTES[h % MONO_PALETTES.length] : PALETTES[h % PALETTES.length];
    const shapes = Array.from({ length: 5 }, (_, i) => {
      const x = 60 + ((h >>> (i * 3)) % 400);
      const y = 60 + ((h >>> (i * 5)) % 300);
      const r = 30 + ((h >>> (i * 2)) % 90);
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? mid : accent}" opacity="${0.25 + (i % 3) * 0.2}"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/>${shapes}</svg>`;
    return { bytes: Buffer.from(svg, 'utf8'), mime: 'image/svg+xml' };
  }

  async test(): Promise<string> {
    return 'Mock image provider ready (developer mode).';
  }
}
