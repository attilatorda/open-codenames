import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import type { LibraryImage, LibraryStats } from '@shared/ipc';
import type { DeckCardInfo, DeckInfo, DeckManifest } from '@shared/deck';
import { captionFor } from '@core/images/promptBuilder';
import { createRng } from '@core/util/rng';
import { WriteQueue, readJson, writeJson } from '../store/jsonFile';
import { extFor } from '../providers/image/types';

export interface LibraryEntry {
  id: string;
  file: string;
  mime: string;
  source: 'generated' | 'folder' | 'mock' | 'deck';
  concept?: string;
  prompt?: string;
  styleId?: string;
  provider?: string;
  model?: string;
  caption?: string;
  folder?: string;
  createdAt: string;
}

interface LibraryIndex {
  version: 1;
  images: Record<string, LibraryEntry>;
}

const IMAGE_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_FOLDER_IMAGES = 2000;

/**
 * Local image store: every generated picture is cached here (so repeated concepts cost nothing),
 * and pictures from the player's own folder are indexed in place (never copied).
 */
export class ImageLibrary {
  readonly dir: string;
  private readonly indexPath: string;
  private index: LibraryIndex = { version: 1, images: {} };
  private readonly queue = new WriteQueue();

  constructor(userData: string) {
    this.dir = join(userData, 'images');
    this.indexPath = join(this.dir, 'index.json');
  }

  async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    this.index = await readJson<LibraryIndex>(this.indexPath, { version: 1, images: {} });
    if (!this.index.images) this.index = { version: 1, images: {} };
  }

  static cacheKey(provider: string, model: string, quality: string, prompt: string): string {
    return `g${createHash('sha256').update(`${provider}|${model}|${quality}|${prompt}`).digest('hex').slice(0, 31)}`;
  }

  static deckImageId(deckId: string, cardId: string): string {
    return `d${createHash('sha256').update(`deck|${deckId}|${cardId}`).digest('hex').slice(0, 31)}`;
  }

  /** Picture collections (built-in and imported): kept in memory, never written to the player's index. */
  private decks = new Map<string, { info: DeckInfo; dir: string; entries: Map<string, LibraryEntry> }>();

  /** Load every collection folder (each holding a deck.json) under `root`. */
  async loadDecks(root: string, builtIn: boolean): Promise<void> {
    const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const d of dirs) if (d.isDirectory()) await this.loadDeck(join(root, d.name), builtIn);
  }

  async loadDeck(deckDir: string, builtIn: boolean): Promise<DeckInfo | null> {
    const manifest = await readJson<DeckManifest | null>(join(deckDir, 'deck.json'), null);
    if (!manifest?.cards?.length) return null;
    const deckId = manifest.id || basename(deckDir);
    const entries = new Map<string, LibraryEntry>();
    const cards: DeckCardInfo[] = [];
    for (const card of manifest.cards) {
      const file = join(deckDir, card.file);
      if (!existsSync(file)) continue;
      const imageId = ImageLibrary.deckImageId(deckId, card.id);
      entries.set(imageId, {
        id: imageId,
        file,
        mime: IMAGE_EXT[extname(file).toLowerCase()] ?? 'image/jpeg',
        source: 'deck',
        caption: card.caption || undefined,
        createdAt: '',
      });
      cards.push({ ...card, imageId });
    }
    const info: DeckInfo = { id: deckId, name: manifest.name || deckId, description: manifest.description ?? '', builtIn, cards };
    this.decks.set(deckId, { info, dir: deckDir, entries });
    return info;
  }

  deckInfos(): DeckInfo[] {
    return [...this.decks.values()].map((d) => d.info).sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name));
  }

  deckInfo(deckId: string): DeckInfo | undefined {
    return this.decks.get(deckId)?.info;
  }

  /** Remove an imported collection (built-in ones cannot be removed). */
  async removeDeck(deckId: string): Promise<boolean> {
    const d = this.decks.get(deckId);
    if (!d || d.info.builtIn) return false;
    this.decks.delete(deckId);
    await fs.rm(d.dir, { recursive: true, force: true });
    return true;
  }

  pickDeck(deckId: string, count: number, seed: number): LibraryImage[] {
    const cards = this.decks.get(deckId)?.info.cards ?? [];
    if (cards.length < count) return [];
    return createRng(seed)
      .shuffle(cards)
      .slice(0, count)
      // The caption (when present) doubles as the spymaster's note about what the card shows.
      .map((c) => ({
        imageId: c.imageId,
        concept: c.caption ? c.caption.replace(/\.$/, '') : undefined,
        caption: c.caption || undefined,
        source: 'deck' as const,
      }));
  }

  get(id: string): LibraryEntry | undefined {
    for (const d of this.decks.values()) {
      const e = d.entries.get(id);
      if (e) return e;
    }
    const e = this.index.images[id];
    return e && existsSync(e.file) ? e : undefined;
  }

  async saveGenerated(
    id: string,
    bytes: Buffer,
    mime: string,
    meta: { concept: string; prompt: string; styleId: string; provider: string; model: string; mock: boolean },
  ): Promise<LibraryEntry> {
    const file = join(this.dir, `${id}.${extFor(mime)}`);
    await fs.writeFile(file, bytes);
    const entry: LibraryEntry = {
      id,
      file,
      mime,
      source: meta.mock ? 'mock' : 'generated',
      concept: meta.concept,
      prompt: meta.prompt,
      styleId: meta.styleId,
      provider: meta.provider,
      model: meta.model,
      caption: captionFor(meta.concept),
      createdAt: new Date().toISOString(),
    };
    this.index.images[id] = entry;
    await this.persist();
    return entry;
  }

  /** Re-index the player's picture folder (one level of subfolders). */
  async scanFolder(folder: string | undefined): Promise<number> {
    for (const [id, e] of Object.entries(this.index.images)) {
      if (e.source === 'folder') delete this.index.images[id];
    }
    let count = 0;
    if (folder && existsSync(folder)) {
      const root = resolve(folder);
      const files = await listImages(root, 1);
      for (const file of files.slice(0, MAX_FOLDER_IMAGES)) {
        const st = await fs.stat(file).catch(() => undefined);
        if (!st || st.size > 20_000_000) continue;
        const id = `f${createHash('sha256').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 31)}`;
        this.index.images[id] = {
          id,
          file,
          mime: IMAGE_EXT[extname(file).toLowerCase()],
          source: 'folder',
          folder: root,
          createdAt: new Date(st.mtimeMs).toISOString(),
        };
        count++;
      }
    }
    await this.persist();
    return count;
  }

  /** Images available for a board built from the library (no generation). */
  usable(includeMock: boolean): LibraryEntry[] {
    return Object.values(this.index.images).filter(
      (e) => (e.source !== 'mock' || includeMock) && existsSync(e.file),
    );
  }

  pick(count: number, seed: number, includeMock: boolean): LibraryImage[] {
    const pool = this.usable(includeMock);
    if (pool.length < count) return [];
    return createRng(seed)
      .shuffle(pool)
      .slice(0, count)
      .map((e) => ({ imageId: e.id, concept: e.concept, caption: e.caption, source: e.source }));
  }

  stats(folderPath?: string, includeMock = false): LibraryStats {
    const usable = this.usable(includeMock);
    return {
      total: usable.length,
      generated: usable.filter((e) => e.source !== 'folder').length,
      folder: usable.filter((e) => e.source === 'folder').length,
      folderPath,
    };
  }

  async clearGenerated(): Promise<void> {
    for (const [id, e] of Object.entries(this.index.images)) {
      if (e.source === 'folder') continue;
      await fs.rm(e.file, { force: true }).catch(() => undefined);
      delete this.index.images[id];
    }
    await this.persist();
  }

  private persist(): Promise<void> {
    return this.queue.run(() => writeJson(this.indexPath, this.index));
  }
}

async function listImages(dir: string, depth: number): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && depth > 0 && !e.name.startsWith('.')) out.push(...(await listImages(full, depth - 1)));
    else if (e.isFile() && IMAGE_EXT[extname(e.name).toLowerCase()]) out.push(full);
  }
  return out;
}
