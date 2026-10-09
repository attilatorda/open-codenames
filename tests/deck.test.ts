import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeckManifest } from '@shared/deck';

const dir = join(__dirname, '..', 'resources', 'decks', 'grandville');
const deck = JSON.parse(readFileSync(join(dir, 'deck.json'), 'utf8')) as DeckManifest;

describe('standard deck', () => {
  it('has 50–80 cards with unique ids', () => {
    expect(deck.cards.length).toBeGreaterThanOrEqual(50);
    expect(deck.cards.length).toBeLessThanOrEqual(80);
    expect(new Set(deck.cards.map((c) => c.id)).size).toBe(deck.cards.length);
  });

  it('ships every card image', () => {
    for (const c of deck.cards) expect(existsSync(join(dir, c.file)), c.file).toBe(true);
  });

  it('credits every card: artist, title, year, source and a public-domain license', () => {
    for (const c of deck.cards) {
      expect(c.artist, c.id).toBeTruthy();
      expect(c.title, c.id).toBeTruthy();
      expect(c.year, c.id).toMatch(/\d{4}/);
      expect(c.sourceURL, c.id).toMatch(/^https:\/\//);
      expect(c.license.toLowerCase(), c.id).toMatch(/public domain/);
      expect(c.caption.length, c.id).toBeGreaterThan(10);
    }
  });
});
