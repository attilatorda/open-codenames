import type { Role, TeamId } from '../types';
import type { OperativeView, SpymasterView } from '../engine/views';
import { operativeViewFromSpymaster } from '../engine/views';
import type {
  ClueDecision,
  DecisionMeta,
  GuessDecision,
  IPlayer,
  PublicObservation,
  TurnContext,
} from '../players/IPlayer';
import type { IRuleSet } from '../rules/rules';
import { StandardRules } from '../rules/rules';
import { TEAM_NAMES } from '../teams';
import { createRng, type Rng } from '../util/rng';
import type { LLMClient, LLMMessage, LLMResponse } from './LLMClient';
import { AI_PROFILE, type Personality } from './personalities';
import {
  OperativeReplySchema,
  ParseError,
  SimulationReplySchema,
  SpymasterReplySchema,
  parseReply,
  type OperativeReply,
} from './parse';
import { cluesGiven } from './prompts/common';
import { buildSpymasterPrompt } from './prompts/spymaster';
import { buildOperativePrompt, buildSimulationPrompt } from './prompts/operative';
import { cluesGivenBy, estimatePace, planClueSize, sampleSize, type ClueSizeMode } from './strategy/clueSize';
import { applySimulation, evaluateCandidates, type EvaluatedCandidate } from './strategy/evaluate';
import { shouldTakeGuess } from './strategy/stopping';
import type { z } from 'zod';

export class AIPlayerError extends Error {
  constructor(
    readonly friendly: string,
    readonly detail?: string,
  ) {
    super(friendly);
    this.name = 'AIPlayerError';
  }
}

export interface LLMPlayerConfig {
  id: string;
  /** Seat name, used in messages shown to the player. */
  name: string;
  team: TeamId;
  role: Role;
  slot: number;
  modelLabel: string;
  /** How this player plays; defaults to the one AI profile. Tests and tools may pass a variant. */
  personality?: Personality;
  client: LLMClient;
  seed: number;
  /** Asked before every clue (the human teammate picks the clue size); 'auto' when absent. */
  chooseClueSize?: (signal: AbortSignal) => Promise<ClueSizeMode>;
  /** -1 … +1 global difficulty/risk bias from settings. */
  riskBias?: number;
  rules?: IRuleSet;
}

interface GuessPlan {
  turn: number;
  clueWord: string;
  clueNumber: number;
  guesses: OperativeReply['guesses'];
  interpretation?: string;
  cursor: number;
}

interface OwnClue {
  turn: number;
  word: string;
  number: number;
  targets: string[];
}

const MAX_NOTES = 8;
const CANDIDATES = 4;

/**
 * One AI seat. Each instance has its own model slot, randomness and memory, and only ever sees
 * the view the engine hands it — the pictures themselves, never a text description of them.
 */
export class LLMPlayer implements IPlayer {
  readonly kind = 'ai' as const;
  readonly id: string;
  private readonly rng: Rng;
  private readonly rules: IRuleSet;
  private readonly profile: Personality;
  private notes: string[] = [];
  private plan?: GuessPlan;
  private planMeta: DecisionMeta = {};
  private ownClue?: OwnClue;
  private turnPicks: { coord: string; kind: string; correct: boolean }[] = [];
  private sizeChoice?: { turn: number; mode: ClueSizeMode };

  constructor(private readonly cfg: LLMPlayerConfig) {
    this.id = cfg.id;
    this.rng = createRng(cfg.seed);
    this.rules = cfg.rules ?? new StandardRules();
    this.profile = cfg.personality ?? AI_PROFILE;
  }

  /** Private memory, shown in the debrief. */
  get memory(): readonly string[] {
    return this.notes;
  }

  // ───────────────────────────── Spymaster ─────────────────────────────

  async giveClue(view: SpymasterView, ctx: TurnContext): Promise<ClueDecision> {
    const p = this.profile;
    let mode: ClueSizeMode = 'auto';
    if (this.cfg.chooseClueSize) {
      // Asked once per turn; a retry after a provider error reuses the answer.
      if (this.sizeChoice?.turn !== view.turnNumber) {
        ctx.status('waiting-human');
        this.sizeChoice = { turn: view.turnNumber, mode: await this.cfg.chooseClueSize(ctx.signal) };
      }
      mode = this.sizeChoice.mode;
    }
    const started = Date.now();
    let calls = 0;
    ctx.status('studying');

    const myRemaining = view.remaining[view.team];
    const usedWords = cluesGiven(view.history);
    const sizePlan = planClueSize({
      mode,
      myRemaining,
      oppRemaining: view.remaining[view.opponent],
      cluesGiven: cluesGivenBy(view.history, view.team),
      opponentPace: estimatePace(view.history, view.opponent),
      risk: clamp(p.risk + (this.cfg.riskBias ?? 0), -1, 1),
      situational: p.situational,
    });
    const desired = sampleSize(sizePlan.distribution, this.rng);
    const evalCtx = {
      desiredSize: desired,
      risk: clamp(p.risk + (this.cfg.riskBias ?? 0), -1, 1),
      situational: p.situational,
      validate: (word: string, n: number) => this.rules.validateClue(word, n, myRemaining),
      usedWords,
    };

    ctx.status('thinking-clue');
    const prompt = buildSpymasterPrompt({
      view,
      personality: p,
      desiredSize: desired,
      sizeReason: sizePlan.reason,
      candidateCount: CANDIDATES,
      teammateNotes: this.notes,
    });

    let evaluated: EvaluatedCandidate[] = [];
    let messages = prompt.messages;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, response } = await this.ask(
        prompt.system,
        messages,
        SpymasterReplySchema,
        ctx,
        `spymaster:${view.team}`,
        1400,
        'medium',
      );
      calls += response.calls;
      ctx.status('weighing');
      evaluated = evaluateCandidates(data.candidates, view, evalCtx);
      if (evaluated.some((c) => !c.rejected)) break;
      // Every candidate was illegal or already used: explain why and ask once more.
      const reasons = evaluated.map((c) => `"${c.word}": ${c.rejected}`).join('; ');
      const used = [...new Set(usedWords)];
      messages = [
        ...messages,
        { role: 'assistant', content: [{ type: 'text', text: response.text }] },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `None of those clues can be used (${reasons}). Targets must be your own team’s hidden pictures, ` +
                'each clue must be one word of letters only, and no clue given earlier this game may be repeated' +
                (used.length ? ` (${used.join(', ')})` : '') +
                '. Try again with JSON only.',
            },
          ],
        },
      ];
    }
    let valid = evaluated.filter((c) => !c.rejected);
    if (valid.length === 0) {
      throw new AIPlayerError(`${this.cfg.name} could not come up with a legal clue.`, 'All candidate clues were rejected.');
    }

    let simulationNote: string | undefined;
    if (p.simulatesTeammate && valid.length > 1) {
      ctx.status('simulating');
      try {
        const top = valid.slice(0, 3);
        const sim = buildSimulationPrompt({
          view: operativeViewFromSpymaster(view),
          clues: top.map((c) => ({ word: c.word, number: c.targets.length })),
          teammateNotes: this.notes,
        });
        const { data, response } = await this.ask(sim.system, sim.messages, SimulationReplySchema, ctx, `simulate:${view.team}`, 600);
        calls += response.calls;
        const adjusted = top.map((c) => {
          const reading = data.readings.find((r) => r.clue.trim().toLowerCase() === c.word);
          return reading ? applySimulation(c, reading.picks, view) : c;
        });
        valid = [...adjusted, ...valid.slice(3)].sort((a, b) => b.score - a.score);
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        simulationNote = `Teammate simulation skipped: ${(err as Error).message}`;
      }
    }

    const best = valid[0];
    const decision: ClueDecision = {
      word: best.word,
      number: best.targets.length,
      intendedTargets: best.targets.map((t) => t.id),
      rationale: best.why,
      meta: {
        model: this.cfg.modelLabel,
        desiredSize: desired,
        sizeReason: sizePlan.reason,
        sizeDistribution: { ...sizePlan.distribution },
        candidates: evaluated.map((c) => ({
          clue: c.word,
          targets: c.targets.map((t) => t.coord),
          score: Number.isFinite(c.score) ? Math.round(c.score * 100) / 100 : 0,
          rejected: c.rejected,
          why: c.why,
        })),
        latencyMs: Date.now() - started,
        llmCalls: calls,
        notes: simulationNote,
      },
    };
    this.ownClue = {
      turn: view.turnNumber,
      word: decision.word,
      number: decision.number,
      targets: best.targets.map((t) => t.coord),
    };
    return decision;
  }

  // ───────────────────────────── Operative ─────────────────────────────

  async nextGuess(view: OperativeView, ctx: TurnContext): Promise<GuessDecision> {
    const clue = view.currentClue;
    if (!clue) throw new AIPlayerError('There is no clue to act on.');
    const p = this.profile;

    if (!this.plan || this.plan.turn !== view.turnNumber) {
      ctx.status('interpreting');
      const started = Date.now();
      const prompt = buildOperativePrompt({
        view,
        clue,
        personality: p,
        notes: this.notes,
      });
      const { data, response } = await this.ask(
        prompt.system,
        prompt.messages,
        OperativeReplySchema,
        ctx,
        `operative:${view.team}`,
        900,
      );
      this.plan = {
        turn: view.turnNumber,
        clueWord: clue.word,
        clueNumber: clue.number,
        guesses: data.guesses,
        interpretation: data.interpretation,
        cursor: 0,
      };
      this.planMeta = { model: this.cfg.modelLabel, latencyMs: Date.now() - started, llmCalls: response.calls };
      if (data.interpretation) ctx.say(data.interpretation);
    }

    ctx.status('deciding');
    const plan = this.plan;
    const selectable = new Map(view.cards.filter((c) => !c.revealed).map((c) => [c.coord.toUpperCase(), c]));
    while (plan.cursor < plan.guesses.length) {
      const g = plan.guesses[plan.cursor++];
      const card = selectable.get(g.card);
      if (!card) continue; // already revealed or not a real coordinate
      const decision = shouldTakeGuess({
        index: view.guessesMade,
        confidence: g.confidence,
        clueNumber: clue.number,
        myRemaining: view.remaining[view.team],
        oppRemaining: view.remaining[view.opponent],
        baseThreshold: p.guessThreshold,
        risk: clamp(p.risk + (this.cfg.riskBias ?? 0), -1, 1),
        situational: p.situational,
      });
      if (!decision.take) {
        return {
          type: 'pass',
          reason: decision.bonus
            ? `That covers the clue — not sure enough to risk an extra pick.`
            : `Nothing else fits ${clue.word.toUpperCase()} well enough, so I’ll stop here.`,
          meta: { ...this.planMeta, notes: `Stopped before ${card.coord}: ${decision.why}` },
        };
      }
      return {
        type: 'guess',
        cardId: card.id,
        confidence: g.confidence,
        reason: g.reason || `Best remaining match for ${clue.word.toUpperCase()}.`,
        meta: { ...this.planMeta, notes: decision.why },
      };
    }

    if (view.guessesMade > 0) {
      return { type: 'pass', reason: `That’s every picture I’d link to ${clue.word.toUpperCase()}.`, meta: this.planMeta };
    }
    // The model listed nothing usable; fail clearly.
    throw new AIPlayerError(`${this.cfg.name} could not decide on a picture.`, 'No selectable pictures in the reply.');
  }

  // ───────────────────────────── Memory ─────────────────────────────

  observe({ event }: PublicObservation): void {
    if (event.type === 'clue' && event.team === this.cfg.team) this.turnPicks = [];
    if (event.type === 'guess' && event.team === this.cfg.team) {
      const kind =
        event.kind === 'NEUTRAL' ? 'neutral' : event.kind === 'ASSASSIN' ? 'ASSASSIN' : event.kind === this.cfg.team ? 'ours' : 'opponents';
      this.turnPicks.push({ coord: event.coord, kind, correct: event.correct });
    }
    if (event.type === 'turnEnd' && event.team === this.cfg.team) {
      const picks = this.turnPicks.map((p) => `${p.coord} (${p.kind})`).join(', ') || 'nothing';
      if (this.cfg.role === 'spymaster' && this.ownClue && this.ownClue.turn === event.turn) {
        const missed = this.ownClue.targets.filter((t) => !this.turnPicks.some((p) => p.coord === t));
        this.remember(
          `Turn ${event.turn}: you gave "${this.ownClue.word}" ${this.ownClue.number} meaning ${this.ownClue.targets.join(', ')}; ` +
            `your teammate picked ${picks}` +
            (missed.length ? `; they did not find ${missed.join(', ')}` : '') +
            '.',
        );
      } else if (this.cfg.role === 'operative' && this.plan && this.plan.turn === event.turn) {
        this.remember(`Turn ${event.turn}: clue "${this.plan.clueWord}" ${this.plan.clueNumber} → you picked ${picks}.`);
      }
      this.turnPicks = [];
    }
  }

  private remember(note: string): void {
    this.notes = [...this.notes, note].slice(-MAX_NOTES);
  }

  // ───────────────────────────── LLM plumbing ─────────────────────────────

  /** Call the model and parse its JSON, with one corrective retry on malformed output. */
  private async ask<T>(
    system: string,
    messages: LLMMessage[],
    schema: z.ZodType<T>,
    ctx: TurnContext,
    purpose: string,
    maxTokens: number,
    effort: 'low' | 'medium' | 'high' = 'low',
  ): Promise<{ data: T; response: LLMResponse & { calls: number } }> {
    let convo = messages;
    let lastError: ParseError | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.cfg.client.complete(
        {
          slot: this.cfg.slot,
          system,
          messages: convo,
          maxTokens,
          temperature: this.profile.temperature,
          json: true,
          effort,
          cacheImages: true,
          purpose: `${purpose}:${TEAM_NAMES[this.cfg.team]}`,
        },
        ctx.signal,
      );
      try {
        return { data: parseReply(schema, response.text), response: { ...response, calls: attempt + 1 } };
      } catch (err) {
        if (!(err instanceof ParseError)) throw err;
        lastError = err;
        convo = [
          ...messages,
          { role: 'assistant', content: [{ type: 'text', text: response.text || '(empty reply)' }] },
          {
            role: 'user',
            content: [{ type: 'text', text: `${err.message} Reply again with ONLY the JSON object, no other text.` }],
          },
        ];
      }
    }
    throw new AIPlayerError(`${this.cfg.name} gave an answer the game could not understand.`, lastError?.message);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
