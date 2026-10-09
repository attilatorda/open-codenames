import { existsSync, promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { nativeImage } from 'electron';
import { csvRecords } from '@shared/csv';
import type { DeckCard, DeckManifest, FolderScan, ImportCollectionRequest } from '@shared/deck';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_SIDE = 1024;
const MAX_CARDS = 300;

type PerPicture = Partial<Record<'title' | 'artist' | 'year' | 'source' | 'sourceurl' | 'license' | 'caption' | 'work', string>>;

async function listImages(folder: string): Promise<string[]> {
  const names = await fs.readdir(folder).catch(() => [] as string[]);
  return names
    .filter((n) => IMAGE_EXT.has(extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** "the_golden-fish (1998).jpg" → "The golden fish (1998)" */
export function titleFromFile(file: string): string {
  const t = basename(file, extname(file)).replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' – ').replace(/\s+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Untitled';
}

/** Per-picture credits from a deck.json or credits.csv (columns: file,title,artist,year,source,sourceURL,license,caption,work). */
async function perPictureMetadata(folder: string): Promise<{ kind: FolderScan['metadata']; byFile: Map<string, PerPicture> }> {
  const byFile = new Map<string, PerPicture>();
  const deckPath = join(folder, 'deck.json');
  if (existsSync(deckPath)) {
    try {
      const manifest = JSON.parse(await fs.readFile(deckPath, 'utf8')) as Partial<DeckManifest>;
      for (const c of manifest.cards ?? []) {
        byFile.set(basename(c.file).toLowerCase(), {
          title: c.title,
          artist: c.artist,
          year: c.year,
          source: c.source,
          sourceurl: c.sourceURL,
          license: c.license,
          caption: c.caption,
          work: c.work,
        });
      }
      return { kind: 'deck.json', byFile };
    } catch {
      // fall through to CSV / defaults
    }
  }
  const csvPath = join(folder, 'credits.csv');
  if (existsSync(csvPath)) {
    for (const r of csvRecords(await fs.readFile(csvPath, 'utf8'))) {
      if (r.file) byFile.set(basename(r.file).toLowerCase(), r as PerPicture);
    }
    return { kind: 'credits.csv', byFile };
  }
  return { kind: null, byFile };
}

export async function scanCollectionFolder(folder: string): Promise<FolderScan> {
  const images = await listImages(folder);
  const { kind } = await perPictureMetadata(folder);
  return { folder, images: images.length, metadata: kind, suggestedName: titleFromFile(basename(folder)) };
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'collection';
}

/**
 * Copy a folder of pictures into the player's collections folder as a new collection.
 * Pictures are downscaled to at most 1024 px; credits come from credits.csv/deck.json, else the form.
 */
export async function importCollection(req: ImportCollectionRequest, collectionsRoot: string): Promise<string> {
  const files = (await listImages(req.folder)).slice(0, MAX_CARDS);
  if (files.length === 0) throw new Error('No PNG, JPG or WebP pictures found in that folder.');
  const { byFile } = await perPictureMetadata(req.folder);
  const id = `${slug(req.name)}-${Date.now().toString(36)}`;
  const dir = join(collectionsRoot, id);
  await fs.mkdir(join(dir, 'cards'), { recursive: true });

  const cards: DeckCard[] = [];
  for (const [i, name] of files.entries()) {
    const src = join(req.folder, name);
    const meta = byFile.get(name.toLowerCase()) ?? {};
    const cardId = `c${String(i + 1).padStart(3, '0')}`;
    let file: string;
    const img = nativeImage.createFromPath(src);
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
      const out = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' }) : img;
      file = `cards/${cardId}.jpg`;
      await fs.writeFile(join(dir, file), out.toJPEG(88));
    } else {
      // Formats nativeImage cannot decode (WebP): keep the original bytes.
      file = `cards/${cardId}${extname(name).toLowerCase()}`;
      await fs.copyFile(src, join(dir, file));
    }
    cards.push({
      id: cardId,
      file,
      caption: meta.caption ?? '',
      title: meta.title || titleFromFile(name),
      artist: meta.artist || req.artist || 'Unknown artist',
      year: meta.year || req.year || '',
      work: meta.work || undefined,
      source: meta.source || req.source || 'Imported by the player',
      sourceURL: meta.sourceurl || req.sourceURL || '',
      license: meta.license || req.license || 'Not specified',
    });
  }
  const artists = [...new Set(cards.map((c) => c.artist))];
  const manifest: DeckManifest = {
    version: 1,
    id,
    name: req.name.trim() || titleFromFile(basename(req.folder)),
    description: `Imported collection — ${cards.length} pictures by ${artists.slice(0, 3).join(', ')}${artists.length > 3 ? ' and others' : ''}.`,
    cards,
  };
  await fs.writeFile(join(dir, 'deck.json'), JSON.stringify(manifest, null, 1), 'utf8');
  return dir;
}
