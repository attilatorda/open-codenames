import { describe, expect, it } from 'vitest';
import { RuleViolation } from '@core/engine/GameEngine';
import { StandardRules } from '@core/rules/rules';
import { LAYOUTS } from '@core/board/layouts';
import { otherTeam } from '@core/types';
import { activeTeam, cardsOf, makeEngine } from './helpers';

describe('board setup', () => {
  it.each(LAYOUTS.map((l) => [l.id]))('layout %s assigns the right card counts', (id) => {
    const engine = makeEngine(7, id);
    const s = engine.getState();
    const count = (k: string) => s.cards.filter((c) => c.kind === k).length;
    expect(s.cards).toHaveLength(s.layout.rows * s.layout.cols);
    expect(count(s.startingTeam)).toBe(s.layout.starting);
    expect(count(otherTeam(s.startingTeam))).toBe(s.layout.other);
    expect(count('NEUTRAL')).toBe(s.layout.neutral);
    expect(count('ASSASSIN')).toBe(0); // Open Codenames has no lose-the-game card
    expect(new Set(s.cards.map((c) => c.image.concept)).size).toBe(s.cards.length);
  });

  it('is reproducible from the seed', () => {
    const a = makeEngine(99).getState();
    const b = makeEngine(99).getState();
    expect(a.cards.map((c) => [c.kind, c.image.concept])).toEqual(b.cards.map((c) => [c.kind, c.image.concept]));
  });
});

describe('clue validation', () => {
  const rules = new StandardRules();
  it('accepts a single word and normalizes it', () => {
    expect(rules.validateClue('  Ocean ', 3, 9)).toEqual({ ok: true, word: 'ocean' });
    expect(rules.validateClue('sci-fi', 2, 9).ok).toBe(true);
  });
  it.each([
    ['two words', 2],
    ['', 1],
    ['A1', 1],
    ['ocean', 0],
    ['ocean', 10],
    ['ocean!', 1],
  ])('rejects %j %d', (word, n) => {
    expect(rules.validateClue(word, n, 9).ok).toBe(false);
  });
  it('rejects numbers above the cards remaining', () => {
    expect(rules.validateClue('ocean', 4, 3).ok).toBe(false);
  });
});

describe('turn flow', () => {
  it('requires a clue before guessing and allows number + 1 guesses', () => {
    const engine = makeEngine();
    const team = activeTeam(engine);
    const mine = cardsOf(engine, team);
    expect(() => engine.guess(team, mine[0].id)).toThrow(RuleViolation);
    engine.giveClue(team, 'test', 1);
    expect(engine.getState().turn.maxGuesses).toBe(2);
    expect(engine.guess(team, mine[0].id).turnEnded).toBe(false);
    const r = engine.guess(team, mine[1].id);
    expect(r.correct).toBe(true);
    expect(r.turnEnded).toBe(true);
    expect(activeTeam(engine)).toBe(otherTeam(team));
    expect(engine.getState().events.at(-1)).toMatchObject({ type: 'turnEnd', reason: 'limit' });
  });

  it('ends the turn on a neutral picture', () => {
    const engine = makeEngine();
    const team = activeTeam(engine);
    engine.giveClue(team, 'test', 2);
    const r = engine.guess(team, cardsOf(engine, 'NEUTRAL')[0].id);
    expect(r.correct).toBe(false);
    expect(r.turnEnded).toBe(true);
    expect(activeTeam(engine)).toBe(otherTeam(team));
  });

  it('gives the opponent the card and ends the turn on an opponent picture', () => {
    const engine = makeEngine();
    const team = activeTeam(engine);
    const opp = otherTeam(team);
    const before = engine.remaining()[opp];
    engine.giveClue(team, 'test', 2);
    engine.guess(team, cardsOf(engine, opp)[0].id);
    expect(engine.remaining()[opp]).toBe(before - 1);
    expect(activeTeam(engine)).toBe(opp);
  });

  it('rule variant: a dealt assassin still loses instantly', () => {
    const engine = makeEngine(42, '5x5', true);
    const team = activeTeam(engine);
    engine.giveClue(team, 'test', 2);
    const r = engine.guess(team, cardsOf(engine, 'ASSASSIN')[0].id);
    expect(r.gameOver).toBe(true);
    const s = engine.getState();
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(otherTeam(team));
    expect(s.winReason).toBe('assassin');
  });

  it('only allows passing after at least one guess', () => {
    const engine = makeEngine();
    const team = activeTeam(engine);
    engine.giveClue(team, 'test', 2);
    expect(() => engine.pass(team)).toThrow(RuleViolation);
    engine.guess(team, cardsOf(engine, team)[0].id);
    engine.pass(team);
    expect(activeTeam(engine)).toBe(otherTeam(team));
  });

  it('rejects revealed cards and out-of-turn actions', () => {
    const engine = makeEngine();
    const team = activeTeam(engine);
    const opp = otherTeam(team);
    expect(() => engine.giveClue(opp, 'test', 1)).toThrow(RuleViolation);
    engine.giveClue(team, 'test', 3);
    const card = cardsOf(engine, team)[0];
    engine.guess(team, card.id);
    expect(() => engine.guess(team, card.id)).toThrow(RuleViolation);
    expect(() => engine.guess(opp, cardsOf(engine, team)[0].id)).toThrow(RuleViolation);
  });

  it('a team wins when its last card is revealed — even by the other team', () => {
    const engine = makeEngine(3, '4x4');
    const team = activeTeam(engine);
    const opp = otherTeam(team);
    // `team` keeps picking opponent cards; the opponents just skip their turns.
    while (engine.getState().phase !== 'over') {
      if (activeTeam(engine) === opp) {
        engine.skipTurn(opp);
        continue;
      }
      engine.giveClue(team, 'test', 1);
      engine.guess(team, cardsOf(engine, opp)[0].id);
    }
    const s = engine.getState();
    expect(s.winner).toBe(opp);
    expect(s.winReason).toBe('all-found');
    expect(s.events.at(-1)).toMatchObject({ type: 'gameOver', winner: opp });
  });

  it('skipTurn hands the turn over without a clue', () => {
    const engine = makeEngine();
    const team = activeTeam(engine);
    engine.skipTurn(team);
    expect(activeTeam(engine)).toBe(otherTeam(team));
    expect(engine.getState().events.at(-1)).toMatchObject({ type: 'turnEnd', reason: 'skipped' });
  });

  it('never lets callers mutate engine state', () => {
    const engine = makeEngine();
    const s = engine.getState();
    s.cards[0].revealed = true;
    s.cards[0].kind = 'ASSASSIN';
    expect(engine.getState().cards[0].revealed).toBe(false);
  });
});
