import { promises as fs } from 'node:fs';
import { nativeImage } from 'electron';
import type { ResolvedImage } from '../providers/llm/types';
import type { ImageLibrary } from './ImageLibrary';

const MAX_SIDE = 384;
const RAW_LIMIT = 4_500_000;
const CACHE_LIMIT = 300;

/** Small JPEG thumbnails of board pictures for vision models (cheap on tokens, cached in memory). */
export class ThumbnailCache {
  private cache = new Map<string, ResolvedImage | null>();

  constructor(private readonly library: ImageLibrary) {}

  async get(imageId: string): Promise<ResolvedImage | null> {
    if (this.cache.has(imageId)) return this.cache.get(imageId)!;
    const value = await this.build(imageId);
    this.cache.set(imageId, value);
    if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }

  private async build(imageId: string): Promise<ResolvedImage | null> {
    const entry = this.library.get(imageId);
    if (!entry || entry.mime === 'image/svg+xml') return null;
    const img = nativeImage.createFromPath(entry.file);
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
      const resized = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : img;
      return { mimeType: 'image/jpeg', base64: resized.toJPEG(82).toString('base64') };
    }
    // Formats nativeImage cannot decode (e.g. WebP): send the original if it is small enough.
    const bytes = await fs.readFile(entry.file).catch(() => undefined);
    if (!bytes || bytes.length > RAW_LIMIT) return null;
    return { mimeType: entry.mime, base64: bytes.toString('base64') };
  }
}
