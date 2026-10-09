// Dev tool: watch the offline mock AI play AI-vs-AI games on standard-deck boards, printing every
// clue with its intended pictures and every pick. Use it to sanity-check the mock's play.
// Usage: npx tsx scripts/mock-sim.mts [games=3] [firstSeed=1] [deckId=grandville]
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LLMPlayer } from '../src/core/ai/LLMPlayer';
import type { LLMClient } from '../src/core/ai/LLMClient';
import { mockBrainReply } from '../src/core/ai/mockBrain';
import { planFromLibrary } from '../src/core/board/boardGenerator';
import { getLayout } from '../src/core/board/layouts';
import { GameEngine } from '../src/core/engine/GameEngine';
import { MatchController } from '../src/core/engine/MatchController';
import type { Seat } from '../src/core/players/IPlayer';
import type { Role, TeamId } from '../src/core/types';
import type { DeckManifest } from '../src/shared/deck';

const games = Number(process.argv[2] ?? 3);
const firstSeed = Number(process.argv[3] ?? 1);
const deck = JSON.parse(await readFile(join(process.cwd(), 'resources', 'decks', process.argv[4] ?? 'grandville', 'deck.json'), 'utf8')) as DeckManifest;
const images = deck.cards.map((c) => ({ imageId: c.id, concept: c.caption?.replace(/\.$/, ''), caption: c.caption, source: 'deck' as const }));
// The mock cannot see pictures: it reads each picture's library description instead, as with the mock provider.
const captions = new Map(images.map((i) => [i.imageId, i.caption]));
const client: LLMClient = { complete: async (req) => ({ text: mockBrainReply(req, (id) => captions.get(id)), model: 'mock' }) };

let correct = 0;
let picks = 0;
for (let g = 0; g < games; g++) {
  const seed = firstSeed + g;
  const layout = getLayout('4x5');
  const plan = planFromLibrary(seed, layout, images);
  const engine = new GameEngine({ id: `sim-${seed}`, seed, layout, cards: plan.cards, startingTeam: plan.startingTeam });
  const caption = (id: number) => engine.getState().cards[id].image.caption?.replace(/\.$/, '') ?? '?';
  const seat = (team: TeamId, role: Role): Seat => {
    const id = `${team}-${role}`;
    return {
      id,
      team,
      role,
      name: id,
      player: new LLMPlayer({ id, name: id, team, role, slot: 0, modelLabel: 'mock', client, seed: seed * 7 + id.length }),
    };
  };
  const seats = [seat('A', 'spymaster'), seat('A', 'operative'), seat('B', 'spymaster'), seat('B', 'operative')];
  console.log(`\n══ Game ${seed}`);
  const controller = new MatchController(engine, seats, {
    onClue: (s, d) => {
      console.log(`\n${s.team} clue ${d.word.toUpperCase()} ${d.number}`);
      for (const id of d.intendedTargets ?? []) console.log(`   meant ${engine.getState().cards[id].coord}: ${caption(id)}`);
    },
    onSpeech: (s, text) => console.log(`   ${s.id} says: ${text}`),
    onGuessDecision: (s, d) => {
      if (d.type === 'pass') return console.log(`   ${s.id} stops: ${d.reason}`);
      const card = engine.getState().cards[d.cardId];
      const ok = card.kind === s.team;
      picks++;
      if (ok) correct++;
      console.log(`   pick ${card.coord} ${ok ? '✓' : card.kind === 'NEUTRAL' ? '· neutral' : '✗ opponents'}  (${caption(d.cardId)}) — ${d.reason}`);
    },
  });
  const end = await controller.run();
  console.log(`→ winner ${end.winner} after ${end.turn.number} turns`);
}
console.log(`\nPicks for own team: ${correct}/${picks} (${Math.round((100 * correct) / Math.max(1, picks))}%)`);
