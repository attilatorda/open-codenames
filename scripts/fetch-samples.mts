// Dev tool: plan a real board with the game's own generator and fetch its pictures from the
// free Pollinations endpoint, to check the art direction and to test with real images.
// Usage: npx tsx scripts/fetch-samples.mts [seed] [layoutId]
// Output: .samples/board-<seed>/<coord>.jpg + manifest.json (includes the secret key, dev only).
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { ConceptBoardGenerator } from '../src/core/board/boardGenerator';
import { getLayout } from '../src/core/board/layouts';

const seed = Number(process.argv[2] ?? 2026);
const layout = getLayout(process.argv[3] ?? '4x5');
const plan = new ConceptBoardGenerator().plan(seed, layout, 'ink');
const dir = join(process.cwd(), '.samples', `board-${seed}`);
await mkdir(dir, { recursive: true });

const manifest = {
  seed,
  layoutId: layout.id,
  startingTeam: plan.startingTeam,
  cards: plan.cards.map((c) => ({ id: c.id, coord: c.coord, kind: c.kind, concept: c.concept, prompt: c.prompt, file: `${c.coord}.jpg` })),
};
await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const exists = (p: string) => access(p).then(() => true, () => false);
for (const card of plan.cards) {
  const file = join(dir, `${card.coord}.jpg`);
  if (await exists(file)) continue;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(card.prompt)}?width=640&height=640&nologo=true&seed=${seed + card.id}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) }).catch((e) => e as Error);
    if (res instanceof Response && res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) {
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      console.log(`${card.coord} ok  ${card.concept}`);
      break;
    }
    const why = res instanceof Response ? `HTTP ${res.status}` : res.message;
    console.log(`${card.coord} retry ${attempt} (${why})`);
    await new Promise((r) => setTimeout(r, 20_000 * attempt));
  }
  // Anonymous tier allows roughly one request every 15 seconds.
  await new Promise((r) => setTimeout(r, 17_000));
}
console.log(`done → ${dir}`);
