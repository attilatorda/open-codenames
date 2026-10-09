// Dev tool: deal a board from the standard deck into a folder the agent harness can use.
// Usage: npx tsx scripts/deck-board.mts [seed] [layoutId]  →  .samples/deck-board-<seed>/
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assignKinds } from '../src/core/board/boardGenerator';
import { coordFor, getLayout, layoutSize } from '../src/core/board/layouts';
import { createRng } from '../src/core/util/rng';
import type { DeckManifest } from '../src/shared/deck';

const seed = Number(process.argv[2] ?? 7);
const layout = getLayout(process.argv[3] ?? '4x5');
const deckDir = join(process.cwd(), 'resources', 'decks', process.argv[4] ?? 'grandville');
const deck = JSON.parse(await readFile(join(deckDir, 'deck.json'), 'utf8')) as DeckManifest;
const rng = createRng(seed);
const startingTeam = rng.next() < 0.5 ? 'A' : 'B';
const kinds = assignKinds(layout, startingTeam, rng);
const picked = rng.shuffle(deck.cards).slice(0, layoutSize(layout));
const out = join(process.cwd(), '.samples', `deck-board-${seed}`);
await mkdir(out, { recursive: true });
const cards = picked.map((c, i) => ({ id: i, coord: coordFor(i, layout), kind: kinds[i], concept: c.caption.replace(/\.$/, ''), prompt: '', file: `${coordFor(i, layout)}.jpg`, deckId: c.id }));
for (const c of cards) await copyFile(join(deckDir, picked[c.id].file), join(out, c.file));
await writeFile(join(out, 'manifest.json'), JSON.stringify({ seed, layoutId: layout.id, startingTeam, cards }, null, 2));
console.log(`dealt ${cards.length} cards → ${out} (starting team ${startingTeam})`);
