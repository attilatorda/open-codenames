// Risk / reward scoring of candidate clues. The LLM proposes clues and estimates link
// strengths; the engine-side strategy layer checks them against the real key and decides.

import type { CardKind } from '../../types';
import type { SecretCard, SpymasterView } from '../../engine/views';
import type { ClueValidation } from '../../rules/rules';

export interface CandidateInput {
  clue: string;
  targets: { card: string; strength: number }[];
  risks: { card: string; level: number }[];
  why?: string;
}

export interface EvaluatedCandidate {
  word: string;
  targets: SecretCard[];
  strengths: number[];
  risks: { card: SecretCard; level: number }[];
  why?: string;
  expectedCorrect: number;
  riskPenalty: number;
  score: number;
  rejected?: string;
  /** Adjustment from the "simulate my teammate" pass, if any. */
  simulationDelta?: number;
}

export interface EvaluationContext {
  desiredSize: number;
  /** -1 … +1 */
  risk: number;
  situational: number;
  validate: (word: string, number: number) => ClueValidation;
  /** Clue words already given this game; none of them may be given again. */
  usedWords?: readonly string[];
}

/** Lower-case singular form, so "Birds" and "bird" count as the same clue. */
export function clueKey(word: string): string {
  const w = word.trim().toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

const RISK_WEIGHTS: Record<Exclude<CardKind, 'A' | 'B'> | 'OPPONENT', number> = {
  OPPONENT: 1,
  NEUTRAL: 0.45,
  ASSASSIN: 4,
};
/** Average cost of a miss on an unflagged picture (a mix of neutral and opponent cards). */
const MISS_COST = 0.35;

export function evaluateCandidates(
  candidates: CandidateInput[],
  view: SpymasterView,
  ctx: EvaluationContext,
): EvaluatedCandidate[] {
  const byCoord = new Map(view.cards.map((c) => [c.coord.toUpperCase(), c]));
  const myRemaining = view.remaining[view.team];
  const oppRemaining = view.remaining[view.opponent];
  const desperate = oppRemaining <= 2 && myRemaining > oppRemaining;
  const seenWords = new Set<string>();
  const usedKeys = new Set((ctx.usedWords ?? []).map(clueKey));

  const out = candidates.map((cand): EvaluatedCandidate => {
    const base: EvaluatedCandidate = {
      word: cand.clue.trim().toLowerCase(),
      targets: [],
      strengths: [],
      risks: [],
      why: cand.why,
      expectedCorrect: 0,
      riskPenalty: 0,
      score: -Infinity,
    };

    // Keep only targets that really are this team's hidden cards, strongest first.
    const seen = new Set<number>();
    const targets = cand.targets
      .map((t) => ({ card: byCoord.get(t.card.toUpperCase()), strength: t.strength }))
      .filter((t): t is { card: SecretCard; strength: number } => {
        if (!t.card || t.card.revealed || t.card.kind !== view.team || seen.has(t.card.id)) return false;
        seen.add(t.card.id);
        return true;
      })
      .sort((a, b) => b.strength - a.strength);

    if (targets.length === 0) return { ...base, rejected: 'no valid targets' };
    const validation = ctx.validate(cand.clue, targets.length);
    if (!validation.ok) return { ...base, rejected: validation.error ?? 'invalid clue' };
    if (usedKeys.has(clueKey(validation.word!))) return { ...base, rejected: 'already given this game' };
    if (seenWords.has(validation.word!)) return { ...base, rejected: 'duplicate' };
    seenWords.add(validation.word!);

    // Operatives stop at their first miss, so later targets only count if earlier ones land.
    // Every miss also lands on some non-team picture, which has a cost of its own.
    let reach = 1;
    let expectedCorrect = 0;
    let expectedMisses = 0;
    for (const t of targets) {
      expectedMisses += reach * (1 - t.strength);
      reach *= t.strength;
      expectedCorrect += reach;
    }

    // Look up the true identity of every risk the model flagged; ignore its own-team mentions.
    const risks = cand.risks
      .map((r) => ({ card: byCoord.get(r.card.toUpperCase()), level: r.level }))
      .filter((r): r is { card: SecretCard; level: number } => !!r.card && !r.card.revealed && r.card.kind !== view.team);
    let riskPenalty = 0;
    for (const r of risks) {
      let w =
        r.card.kind === 'ASSASSIN'
          ? RISK_WEIGHTS.ASSASSIN * (1 - 0.4 * ctx.risk)
          : r.card.kind === 'NEUTRAL'
            ? RISK_WEIGHTS.NEUTRAL
            : RISK_WEIGHTS.OPPONENT;
      if (desperate && r.card.kind !== 'ASSASSIN') w *= 0.5;
      riskPenalty += r.level * w * 0.6;
    }

    riskPenalty += expectedMisses * MISS_COST;

    // The size policy is the strategic intent; a different size has to be clearly better to win.
    const sizeTerm = -0.6 * Math.abs(targets.length - ctx.desiredSize) * (0.5 + 0.5 * ctx.situational);
    const finishBonus =
      targets.length === myRemaining ? targets.reduce((p, t) => p * t.strength, 1) * 1.0 : 0;
    const score = expectedCorrect - riskPenalty + sizeTerm + finishBonus;

    return {
      ...base,
      word: validation.word!,
      targets: targets.map((t) => t.card),
      strengths: targets.map((t) => t.strength),
      risks,
      expectedCorrect,
      riskPenalty,
      score,
    };
  });

  return out.sort((a, b) => {
    if (!!a.rejected !== !!b.rejected) return a.rejected ? 1 : -1;
    return b.score - a.score;
  });
}

/**
 * Fold in a predicted reading of the clue by the teammate (Analyst personality).
 * `picks` are the coords the simulated operative would choose, best first.
 */
export function applySimulation(
  cand: EvaluatedCandidate,
  picks: string[],
  view: SpymasterView,
): EvaluatedCandidate {
  const byCoord = new Map(view.cards.map((c) => [c.coord.toUpperCase(), c]));
  const targetIds = new Set(cand.targets.map((t) => t.id));
  let delta = 0;
  for (const coord of picks.slice(0, cand.targets.length)) {
    const card = byCoord.get(coord.toUpperCase());
    if (!card || card.revealed) continue;
    if (targetIds.has(card.id)) delta += 0.25;
    else if (card.kind === view.team) delta += 0.1;
    else if (card.kind === 'NEUTRAL') delta -= 0.5;
    else if (card.kind === 'ASSASSIN') delta -= 3;
    else delta -= 0.8;
  }
  return { ...cand, score: cand.score + delta, simulationDelta: delta };
}
