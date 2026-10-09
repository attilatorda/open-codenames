import { describe, expect, it } from 'vitest';
import { LLMPlayer } from '@core/ai/LLMPlayer';
import type { LLMClient } from '@core/ai/LLMClient';
import { mockBrainReply } from '@core/ai/mockBrain';
import { buildOperativePrompt } from '@core/ai/prompts/operative';
import { buildSpymasterPrompt } from '@core/ai/prompts/spymaster';
import { AI_PROFILE } from '@core/ai/personalities';
import { LAYOUTS, withAssassin } from '@core/board/layouts';
import { MatchController } from '@core/engine/MatchController';
import { buildOperativeView, buildSpymasterView } from '@core/engine/views';
import type { Seat } from '@core/players/IPlayer';
import type { Role, TeamId } from '@core/types';
import { otherTeam } from '@core/types';
import { activeTeam, cardsOf, makeEngine } from './helpers';

describe('assassin option', () => {
  it('turns exactly one neutral picture into the assassin', () => {
    for (const base of LAYOUTS) {
      const layout = withAssassin(base);
      expect(layout.assassin).toBe(1);
      expect(layout.neutral).toBe(base.neutral - 1);
      expect(layout.starting + layout.other + layout.neutral + layout.assassin).toBe(base.rows * base.cols);
      expect(withAssassin(layout)).toEqual(layout);
    }
    const engine = makeEngine(3, '4x5', true);
    expect(engine.getState().cards.filter((c) => c.kind === 'ASSASSIN')).toHaveLength(1);
    expect(makeEngine(3, '4x5').getState().cards.some((c) => c.kind === 'ASSASSIN')).toBe(false);
  });

  it('revealing the assassin loses the game for the guessing team', () => {
    const engine = makeEngine(4, '4x5', true);
    const team = activeTeam(engine);
    engine.giveClue(team, 'ocean', 2);
    const result = engine.guess(team, cardsOf(engine, 'ASSASSIN')[0].id);
    expect(result.gameOver).toBe(true);
    expect(engine.getState().winner).toBe(otherTeam(team));
    expect(engine.getState().winReason).toBe('assassin');
  });

  it('every player is told the rule only when an assassin is dealt', () => {
    const on = makeEngine(6, '4x5', true).getState();
    const off = makeEngine(6, '4x5').getState();
    const operative = (s: typeof on) =>
      buildOperativePrompt({ view: buildOperativeView(s, 'A'), clue: { word: 'ocean', number: 2, team: 'A', turn: 1 }, personality: AI_PROFILE, notes: [] }).system;
    const spymaster = (s: typeof on) =>
      buildSpymasterPrompt({ view: buildSpymasterView(s, 'A'), personality: AI_PROFILE, desiredSize: 2, sizeReason: 'test', candidateCount: 4, teammateNotes: [] }).system;
    expect(operative(on)).toMatch(/ASSASSIN/);
    expect(spymaster(on)).toMatch(/ASSASSIN/);
    expect(operative(off)).not.toMatch(/assassin/i);
    expect(spymaster(off)).not.toMatch(/assassin/i);
    // The operative learns that an assassin exists, never where it is.
    expect(buildOperativeView(on, 'A').assassins).toBe(1);
  });

  it('four AI players finish a game with the assassin on', async () => {
    const engine = makeEngine(21, '4x5', true);
    const client: LLMClient = { complete: async (req) => ({ text: mockBrainReply(req), model: 'mock' }) };
    const seat = (team: TeamId, role: Role, seed: number): Seat => {
      const id = `${team}-${role}`;
      return { id, team, role, name: id, player: new LLMPlayer({ id, name: id, team, role, slot: 0, modelLabel: 'mock', client, seed }) };
    };
    const seats = [seat('A', 'spymaster', 1), seat('A', 'operative', 2), seat('B', 'spymaster', 3), seat('B', 'operative', 4)];
    const final = await new MatchController(engine, seats).run();
    expect(final.phase).toBe('over');
    expect(['assassin', 'all-found']).toContain(final.winReason);
  });
});
