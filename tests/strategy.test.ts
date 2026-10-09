import { describe, expect, it } from 'vitest';
import { OPENING_DISTRIBUTION, planClueSize, sampleSize, estimatePace } from '@core/ai/strategy/clueSize';
import { evaluateCandidates, applySimulation } from '@core/ai/strategy/evaluate';
import { shouldTakeGuess } from '@core/ai/strategy/stopping';
import { buildSpymasterView } from '@core/engine/views';
import { StandardRules } from '@core/rules/rules';
import { createRng } from '@core/util/rng';
import { makeEngine } from './helpers';

const base = { risk: 0, situational: 1, cluesGiven: 2 } as const;
const mean = (d: Record<number, number>) => [1, 2, 3, 4].reduce((s, k) => s + k * d[k], 0);

describe('clue size policy', () => {
  it('opens with 1: 25%, 2: 50%, 3: 25%', () => {
    const plan = planClueSize({ mode: 'auto', myRemaining: 9, oppRemaining: 8, cluesGiven: 0, risk: 0.6, situational: 1 });
    expect(plan.distribution).toEqual(OPENING_DISTRIBUTION);
  });

  it('samples the opening distribution at roughly the right rates', () => {
    const rng = createRng(1);
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (let i = 0; i < 20000; i++) counts[sampleSize(OPENING_DISTRIBUTION, rng)]++;
    expect(counts[1] / 20000).toBeCloseTo(0.25, 1);
    expect(counts[2] / 20000).toBeCloseTo(0.5, 1);
    expect(counts[3] / 20000).toBeCloseTo(0.25, 1);
    expect(counts[4]).toBe(0);
  });

  it('honors the manual setting, capped at the cards remaining', () => {
    expect(planClueSize({ ...base, mode: 3, myRemaining: 6, oppRemaining: 6 }).distribution[3]).toBe(1);
    const capped = planClueSize({ ...base, mode: 4, myRemaining: 2, oppRemaining: 6 });
    expect(capped.distribution[2]).toBe(1);
    expect(capped.reason).toMatch(/only 2 left/);
  });

  it('plays safer when ahead and pushes when behind', () => {
    const ahead = planClueSize({ ...base, mode: 'auto', myRemaining: 4, oppRemaining: 7 });
    const level = planClueSize({ ...base, mode: 'auto', myRemaining: 6, oppRemaining: 6 });
    const behind = planClueSize({ ...base, mode: 'auto', myRemaining: 8, oppRemaining: 5 });
    expect(mean(ahead.distribution)).toBeLessThan(mean(level.distribution));
    expect(mean(level.distribution)).toBeLessThan(mean(behind.distribution));
    expect(ahead.distribution[4]).toBe(0);
    expect(behind.reason).toMatch(/Behind/);
  });

  it('goes for broke when the opponents are about to win', () => {
    const plan = planClueSize({ ...base, mode: 'auto', myRemaining: 6, oppRemaining: 1 });
    expect(plan.reason).toMatch(/going for broke/);
    expect(plan.distribution[3] + plan.distribution[4]).toBeGreaterThan(0.6);
  });

  it('never targets more cards than remain', () => {
    const plan = planClueSize({ ...base, mode: 'auto', myRemaining: 2, oppRemaining: 1 });
    expect(plan.distribution[3]).toBe(0);
    expect(plan.distribution[4]).toBe(0);
    expect(plan.distribution[1] + plan.distribution[2]).toBeCloseTo(1);
  });

  it('a cautious personality shifts toward smaller clues', () => {
    const bold = planClueSize({ ...base, mode: 'auto', myRemaining: 6, oppRemaining: 6, risk: 0.6 });
    const shy = planClueSize({ ...base, mode: 'auto', myRemaining: 6, oppRemaining: 6, risk: -0.6 });
    expect(mean(shy.distribution)).toBeLessThan(mean(bold.distribution));
  });

  it('estimates opponent pace from public history', () => {
    expect(estimatePace([], 'B')).toBeUndefined();
    expect(
      estimatePace(
        [
          { type: 'clue', team: 'B', turn: 1, word: 'x', number: 2 },
          { type: 'guess', team: 'B', turn: 1, cardId: 1, coord: 'A2', kind: 'B', correct: true },
          { type: 'guess', team: 'B', turn: 1, cardId: 2, coord: 'A3', kind: 'B', correct: true },
        ],
        'B',
      ),
    ).toBe(2);
  });
});

describe('candidate evaluation', () => {
  const rules = new StandardRules();
  const setup = () => {
    const engine = makeEngine(21, '5x5', true); // assassin variant, to exercise the risk weights
    const view = buildSpymasterView(engine.getState(), 'A');
    const mine = view.cards.filter((c) => c.kind === 'A');
    const assassin = view.cards.find((c) => c.kind === 'ASSASSIN')!;
    const neutral = view.cards.find((c) => c.kind === 'NEUTRAL')!;
    const opp = view.cards.find((c) => c.kind === 'B')!;
    const ctx = {
      desiredSize: 2,
      risk: 0,
      situational: 1,
      validate: (w: string, n: number) => rules.validateClue(w, n, view.remaining.A),
    };
    return { view, mine, assassin, neutral, opp, ctx };
  };

  it('drops targets that are not the team’s hidden cards and rejects illegal clues', () => {
    const { view, mine, opp, ctx } = setup();
    const out = evaluateCandidates(
      [
        { clue: 'river', targets: [{ card: mine[0].coord, strength: 0.9 }, { card: opp.coord, strength: 0.9 }], risks: [] },
        { clue: 'two words', targets: [{ card: mine[1].coord, strength: 0.9 }], risks: [] },
        { clue: 'ghost', targets: [{ card: opp.coord, strength: 0.9 }], risks: [] },
      ],
      view,
      ctx,
    );
    const river = out.find((c) => c.word === 'river')!;
    expect(river.targets.map((t) => t.id)).toEqual([mine[0].id]);
    expect(out.find((c) => c.word === 'ghost')?.rejected).toBe('no valid targets');
    expect(out.filter((c) => c.rejected)).toHaveLength(2);
    expect(out[0].rejected).toBeUndefined();
  });

  it('weighs assassin risk by the true key, not the model’s label', () => {
    const { view, mine, assassin, neutral, ctx } = setup();
    const targets = [
      { card: mine[0].coord, strength: 0.8 },
      { card: mine[1].coord, strength: 0.8 },
    ];
    const [best, worst] = evaluateCandidates(
      [
        { clue: 'safe', targets, risks: [{ card: neutral.coord, level: 0.5 }] },
        { clue: 'deadly', targets, risks: [{ card: assassin.coord, level: 0.5 }] },
      ],
      view,
      ctx,
    );
    expect(best.word).toBe('safe');
    expect(worst.word).toBe('deadly');
    expect(worst.riskPenalty).toBeGreaterThan(best.riskPenalty * 4);
  });

  it('prefers the size the strategy asked for when strengths are similar', () => {
    const { view, mine, ctx } = setup();
    const t = (n: number) => mine.slice(0, n).map((c) => ({ card: c.coord, strength: 0.75 }));
    const out = evaluateCandidates(
      [
        { clue: 'one', targets: t(1), risks: [] },
        { clue: 'three', targets: t(3), risks: [] },
      ],
      view,
      { ...ctx, desiredSize: 1 },
    );
    expect(out[0].word).toBe('one');
  });

  it('simulation penalizes clues the teammate would misread', () => {
    const { view, mine, assassin, ctx } = setup();
    const [cand] = evaluateCandidates([{ clue: 'river', targets: [{ card: mine[0].coord, strength: 0.9 }], risks: [] }], view, ctx);
    expect(applySimulation(cand, [mine[0].coord], view).simulationDelta).toBeGreaterThan(0);
    expect(applySimulation(cand, [assassin.coord], view).simulationDelta).toBeLessThan(-2);
  });
});

describe('guess stopping', () => {
  const ctx = {
    index: 1,
    confidence: 0.5,
    clueNumber: 2,
    myRemaining: 5,
    oppRemaining: 5,
    baseThreshold: 0.5,
    risk: 0,
    situational: 1,
  };
  it('always takes the first guess', () => {
    expect(shouldTakeGuess({ ...ctx, index: 0, confidence: 0.01 }).take).toBe(true);
  });
  it('compares confidence with the threshold', () => {
    expect(shouldTakeGuess({ ...ctx, confidence: 0.6 }).take).toBe(true);
    expect(shouldTakeGuess({ ...ctx, confidence: 0.3 }).take).toBe(false);
  });
  it('is more willing to continue when behind', () => {
    const behind = shouldTakeGuess({ ...ctx, myRemaining: 7, oppRemaining: 2 });
    const ahead = shouldTakeGuess({ ...ctx, myRemaining: 2, oppRemaining: 7 });
    expect(behind.threshold).toBeLessThan(ahead.threshold);
  });
  it('bonus guesses need a strong read and are skipped when ahead', () => {
    expect(shouldTakeGuess({ ...ctx, index: 2, confidence: 0.6, myRemaining: 7, oppRemaining: 6 }).take).toBe(false);
    expect(shouldTakeGuess({ ...ctx, index: 2, confidence: 0.9, myRemaining: 7, oppRemaining: 6 }).take).toBe(true);
    expect(shouldTakeGuess({ ...ctx, index: 2, confidence: 0.99, myRemaining: 2, oppRemaining: 7 }).take).toBe(false);
  });
});
