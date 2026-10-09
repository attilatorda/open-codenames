import type { ImageProviderId } from '@shared/providers';

export interface ImageContext {
  apiKey?: string;
  model: string;
  baseUrl?: string;
  quality: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export interface ImageRequest {
  prompt: string;
  negativePrompt: string;
  seed?: number;
}

export interface GeneratedImage {
  bytes: Buffer;
  mime: string;
}

/** Vendor-specific image generation; the game only knows prompts and bytes. */
export interface IImageGenerationProvider {
  readonly id: ImageProviderId;
  readonly displayName: string;
  readonly local?: boolean;
  generate(ctx: ImageContext, req: ImageRequest): Promise<GeneratedImage>;
  /** Validate the key/server; returns a human-readable status line. */
  test(ctx: ImageContext): Promise<string>;
}

export function extFor(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('svg')) return 'svg';
  return 'jpg';
}

export function sniffMime(bytes: Buffer, fallback = 'image/png'): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return fallback;
}
