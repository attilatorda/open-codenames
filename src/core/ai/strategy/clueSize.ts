// How many pictures should the spymaster try to connect this turn?
// The opening clue follows a fixed policy (1: 25%, 2: 50%, 3: 25%). After that the AI
// aims for as many as it needs to stay ahead of the opponents' expected pace.

import type { GameEvent, TeamId } from '../../types';
import type { Rng } from '../../util/rng';

export type ClueSizeMode = 'auto' | 1 | 2 | 3 | 4;
export type SizeDistribution = Record<1 | 2 | 3 | 4, number>;

export const OPENING_DISTRIBUTION: SizeDistribution = { 1: 0.25, 2: 0.5, 3: 0.25, 4: 0 };
const SIZES = [1, 2, 3, 4] as const;
const DEFAULT_OPPONENT_PACE = 1.5;

export interface ClueSizeInput {
  mode: ClueSizeMode;
  myRemaining: number;
  oppRemaining: number;
  /** Clues this team has already given this game. */
  cluesGiven: number;
  /** Expected correct guesses per opponent turn. */
  opponentPace?: number;
  /** -1 … +1: personality risk plus difficulty bias. */
  risk: number;
  /** How strongly the score changes behavior (personality). */
  situational: number;
}

export interface ClueSizePlan {
  distribution: SizeDistribution;
  /** Center of the distribution (useful for debugging and the debrief). */
  center: number;
  reason: string;
}

export function planClueSize(input: ClueSizeInput): ClueSizePlan {
  const { myRemaining, oppRemaining } = input;
  const cap = Math.max(1, Math.min(4, myRemaining));

  if (input.mode !== 'auto') {
    const n = Math.min(input.mode, cap) as 1 | 2 | 3 | 4;
    const capped = n < input.mode;
    return {
      distribution: single(n),
      center: n,
      reason: capped
        ? `Player setting: ${input.mode} (only ${myRemaining} left, so ${n})`
        : `Player setting: clues for ${n} picture${n === 1 ? '' : 's'}`,
    };
  }

  if (input.cluesGiven === 0) {
    return {
      distribution: capDistribution(OPENING_DISTRIBUTION, cap),
      center: 2,
      reason: 'Opening policy: 1 (25%) · 2 (50%) · 3 (25%)',
    };
  }

  const pace = clamp(input.opponentPace ?? DEFAULT_OPPONENT_PACE, 0.5, 3);
  // Cards needed this turn so that, after the opponents' next turn, we are still (slightly) ahead.
  const need = myRemaining - oppRemaining + pace + 0.5;
  const s = input.situational;
  let center = 2 + s * 0.75 * (need - 2);
  let reason: string;
  const lead = oppRemaining - myRemaining;

  if (lead >= 2) reason = `Ahead by ${lead} — playing it safe`;
  else if (lead >= 0) reason = lead === 0 ? 'Level — keeping pace' : 'Slightly ahead — staying ahead';
  else reason = `Behind by ${-lead} — pressing to catch up`;

  const opponentsAboutToWin = oppRemaining <= 2 && myRemaining > oppRemaining;
  if (opponentsAboutToWin) {
    center = Math.max(center, Math.min(myRemaining, 4));
    reason = `Opponents need only ${oppRemaining} — going for broke`;
  } else if (myRemaining <= 3) {
    const finishCenter = myRemaining - 0.4 + 0.4 * input.risk;
    if (finishCenter > center) {
      center = finishCenter;
      reason = `${myRemaining} left — trying to finish`;
    }
  }

  center = clamp(center + input.risk * 0.6, 1, 4);
  const sigma = 0.65;
  const raw = {} as SizeDistribution;
  for (const k of SIZES) {
    raw[k] = Math.exp(-((k - center) ** 2) / (2 * sigma * sigma));
  }
  // Four-picture clues are reserved for when the situation calls for them.
  if (center < 2.5 && !opponentsAboutToWin) raw[4] = 0;
  return { distribution: capDistribution(raw, cap), center, reason };
}

export function sampleSize(dist: SizeDistribution, rng: Rng): 1 | 2 | 3 | 4 {
  let r = rng.next();
  for (const k of SIZES) {
    r -= dist[k];
    if (r < 0) return k;
  }
  // Floating point leftovers: return the largest size with any weight.
  for (const k of [...SIZES].reverse()) if (dist[k] > 0) return k;
  return 1;
}

/** Average correct guesses per turn for a team so far. */
export function estimatePace(history: readonly GameEvent[], team: TeamId): number | undefined {
  let turns = 0;
  let correct = 0;
  for (const e of history) {
    if (e.type === 'clue' && e.team === team) turns++;
    if (e.type === 'guess' && e.team === team && e.correct) correct++;
  }
  return turns === 0 ? undefined : correct / turns;
}

export function cluesGivenBy(history: readonly GameEvent[], team: TeamId): number {
  return history.filter((e) => e.type === 'clue' && e.team === team).length;
}

function single(n: 1 | 2 | 3 | 4): SizeDistribution {
  return { 1: 0, 2: 0, 3: 0, 4: 0, [n]: 1 } as SizeDistribution;
}

function capDistribution(dist: SizeDistribution, cap: number): SizeDistribution {
  const out = { ...dist };
  let overflow = 0;
  for (const k of SIZES) {
    if (k > cap) {
      overflow += out[k];
      out[k] = 0;
    }
  }
  out[cap as 1 | 2 | 3 | 4] += overflow;
  const total = SIZES.reduce((sum, k) => sum + out[k], 0);
  if (total <= 0) return single(cap as 1 | 2 | 3 | 4);
  for (const k of SIZES) out[k] = out[k] / total;
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
