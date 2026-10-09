// When should an AI operative keep guessing?

export interface StoppingContext {
  /** 0-based index of the guess being considered this turn. */
  index: number;
  confidence: number;
  clueNumber: number;
  myRemaining: number;
  oppRemaining: number;
  baseThreshold: number;
  risk: number;
  situational: number;
}

export interface StoppingDecision {
  take: boolean;
  threshold: number;
  why: string;
  /** The guess considered was the "+1" beyond the clue number. */
  bonus?: boolean;
}

export function shouldTakeGuess(ctx: StoppingContext): StoppingDecision {
  if (ctx.index === 0) return { take: true, threshold: 0, why: 'At least one guess is required' };

  const lead = ctx.oppRemaining - ctx.myRemaining; // positive: we are ahead
  let threshold = ctx.baseThreshold - ctx.risk * 0.1;
  threshold += clamp(lead * 0.04 * ctx.situational, -0.15, 0.12);
  const opponentsAboutToWin = ctx.oppRemaining <= 1 || (ctx.oppRemaining <= 2 && lead < 0);
  if (opponentsAboutToWin) threshold -= 0.15 * ctx.situational;

  const bonus = ctx.index >= ctx.clueNumber;
  if (bonus) {
    // The "+1" guess is for catching up on earlier clues; only worth it when it is a strong read.
    threshold = Math.max(threshold + 0.25, 0.7);
    if (lead > 0 && !opponentsAboutToWin) {
      return { take: false, threshold, why: 'Ahead — no need for a bonus guess', bonus };
    }
  }
  threshold = clamp(threshold, 0.15, 0.95);
  const take = ctx.confidence >= threshold;
  return {
    take,
    threshold,
    bonus,
    why: take
      ? `Confidence ${pct(ctx.confidence)} ≥ ${pct(threshold)}`
      : `Confidence ${pct(ctx.confidence)} below ${pct(threshold)}`,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
