// Information boundaries: an operative must not be able to learn the key from anything
// the engine gives it. The strongest check is non-interference: two games that differ only
// in the secret identities of hidden cards must produce byte-identical operative prompts.

import { describe, expect, it } from 'vitest';
import { GameEngine } from '@core/engine/GameEngine';
import { buildOperativeView, buildSpymasterView } from '@core/engine/views';
import { buildOperativePrompt } from '@core/ai/prompts/operative';
import { buildSpymasterPrompt } from '@core/ai/prompts/spymaster';
import { AI_PROFILE } from '@core/ai/personalities';
import { createRng } from '@core/util/rng';
import type { Card, CardKind } from '@core/types';
import { makeEngine } from './helpers';

/** Play a few deterministic moves so the board has revealed cards and history. */
function playSomeMoves(engine: GameEngine): void {
  for (let i = 0; i < 3; i++) {
    const s = engine.getState();
    const team = s.turn.team;
    engine.giveClue(team, 'test', 1);
    const target = engine.getState().cards.find((c) => !c.revealed && c.kind === 'NEUTRAL');
    if (target) engine.guess(team, target.id);
  }
}

/** Same board, same revealed history, but hidden kinds shuffled among hidden cards. */
function permuteHidden(engine: GameEngine, seed: number): GameEngine {
  const s = engine.getState();
  const hidden = s.cards.filter((c) => !c.revealed);
  const kinds = createRng(seed).shuffle(hidden.map((c) => c.kind));
  const cards: Card[] = s.cards.map((c) => {
    if (c.revealed) return c;
    return { ...c, kind: kinds[hidden.findIndex((h) => h.id === c.id)] as CardKind };
  });
  const clone = new GameEngine({ id: s.id, seed: s.seed, layout: s.layout, cards, startingTeam: s.startingTeam });
  // Replay the same public moves.
  for (const e of s.events) {
    if (e.type === 'clue') clone.giveClue(e.team, e.word, e.number);
    if (e.type === 'guess') clone.guess(e.team, e.cardId);
  }
  return clone;
}

describe('operative information boundary', () => {
  it('operative views carry no kind for hidden cards', () => {
    const engine = makeEngine(11);
    playSomeMoves(engine);
    const view = buildOperativeView(engine.getState(), 'A');
    for (const c of view.cards) {
      expect(Object.keys(c)).not.toContain('kind');
      expect(Object.keys(c)).not.toContain('concept');
      if (!c.revealed) expect(c.revealedKind).toBeUndefined();
    }
  });

  it('operative prompts are independent of the hidden key', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const a = makeEngine(seed);
      playSomeMoves(a);
      const b = permuteHidden(a, seed * 7);
      // Sanity: the keys really differ.
      const keyA = a.getState().cards.map((c) => c.kind).join();
      const keyB = b.getState().cards.map((c) => c.kind).join();
      if (keyA === keyB) continue;
      for (const team of ['A', 'B'] as const) {
        const clue = { word: 'ocean', number: 2, team, turn: 5 };
        const build = (e: GameEngine) =>
          JSON.stringify(
            buildOperativePrompt({
              view: buildOperativeView(e.getState(), team),
              clue,
              personality: AI_PROFILE,
              notes: [],
            }),
          );
        expect(build(b)).toBe(build(a));
      }
    }
  });

  it('prompts carry the pictures themselves, never a text description of them', () => {
    const engine = makeEngine(5);
    const s = engine.getState();
    const operative = buildOperativePrompt({
      view: buildOperativeView(s, 'A'),
      clue: { word: 'ocean', number: 2, team: 'A', turn: 1 },
      personality: AI_PROFILE,
      notes: [],
    });
    const spymaster = buildSpymasterPrompt({
      view: buildSpymasterView(s, 'A'),
      personality: AI_PROFILE,
      desiredSize: 2,
      sizeReason: 'test',
      candidateCount: 4,
      teammateNotes: [],
    });
    for (const prompt of [operative, spymaster]) {
      const text = JSON.stringify(prompt);
      for (const c of s.cards) {
        expect(text).not.toContain(c.image.concept!);
        if (c.image.caption) expect(text).not.toContain(c.image.caption);
      }
      const images = prompt.messages[0].content.filter((p) => p.type === 'image');
      expect(images.map((p) => (p.type === 'image' ? p.imageId : ''))).toEqual(s.cards.map((c) => c.image.imageId));
    }
  });

  it('spymaster prompts include the key, and no assassin in the standard game', () => {
    const build = (e: GameEngine) =>
      JSON.stringify(
        buildSpymasterPrompt({
          view: buildSpymasterView(e.getState(), 'A'),
          personality: AI_PROFILE,
          desiredSize: 2,
          sizeReason: 'test',
          candidateCount: 4,
          teammateNotes: [],
        }),
      );
    const standard = makeEngine(5);
    const text = build(standard);
    for (const c of standard.getState().cards.filter((c) => c.kind === 'A')) expect(text).toContain(c.coord);
    expect(text).toContain('Your team (Green)');
    expect(text).not.toMatch(/assassin/i);

    // Rule variant with an assassin dealt: the spymaster is told where it is.
    const variant = makeEngine(5, '5x5', true);
    const assassin = variant.getState().cards.find((c) => c.kind === 'ASSASSIN')!;
    expect(build(variant)).toMatch(new RegExp(`ASSASSIN \\(instant loss\\): ${assassin.coord}`));
  });
});
