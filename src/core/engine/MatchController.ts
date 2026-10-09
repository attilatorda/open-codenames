import type { GameState, Role, TeamId } from '../types';
import type { Activity, ClueDecision, GuessDecision, Seat, TurnContext } from '../players/IPlayer';
import { GameEngine, RuleViolation } from './GameEngine';
import { buildOperativeView, buildSpymasterView } from './views';

export class MatchAborted extends Error {
  constructor() {
    super('Match aborted');
    this.name = 'MatchAborted';
  }
}

export type ErrorChoice = 'retry' | 'skip' | 'quit';

export interface SeatStatus {
  seat: Seat;
  activity: Activity;
}

export interface ControllerHooks {
  onStatus?(status: SeatStatus | null): void;
  onSpeech?(seat: Seat, text: string): void;
  onClue?(seat: Seat, decision: ClueDecision, turn: number): void;
  onGuessDecision?(seat: Seat, decision: GuessDecision, turn: number): void;
  /** Lets the UI animate an AI pointing at a card before it flips. */
  beforeReveal?(seat: Seat, cardId: number): Promise<void>;
  /** Pause between AI actions so humans can follow along. */
  pace?(seat: Seat): Promise<void>;
  /** Ask what to do when a player fails (provider outage, invalid AI output…). */
  onError?(seat: Seat, error: unknown, action: 'clue' | 'guess'): Promise<ErrorChoice>;
}

/**
 * Runs the turn loop. Players only ever receive the view for their role;
 * every action goes through the engine for validation.
 */
export class MatchController {
  private readonly unsubscribe: () => void;

  constructor(
    private readonly engine: GameEngine,
    private readonly seats: Seat[],
    private readonly hooks: ControllerHooks = {},
    private readonly signal: AbortSignal = new AbortController().signal,
  ) {
    for (const team of ['A', 'B'] as const) {
      for (const role of ['spymaster', 'operative'] as const) {
        if (!seats.some((s) => s.team === team && s.role === role)) {
          throw new Error(`Missing ${role} for team ${team}`);
        }
      }
    }
    this.unsubscribe = engine.subscribe((state, event) => {
      if (!event) return;
      const remaining = engine.remaining();
      for (const s of this.seats) s.player.observe?.({ event, remaining });
    });
  }

  seat(team: TeamId, role: Role): Seat {
    return this.seats.find((s) => s.team === team && s.role === role)!;
  }

  async run(): Promise<GameState> {
    try {
      for (;;) {
        this.checkAbort();
        const state = this.engine.getState();
        if (state.phase === 'over') return state;
        const team = state.turn.team;
        if (state.phase === 'clue') await this.clueStep(team);
        else await this.guessStep(team);
      }
    } finally {
      this.hooks.onStatus?.(null);
      this.unsubscribe();
    }
  }

  private async clueStep(team: TeamId): Promise<void> {
    const seat = this.seat(team, 'spymaster');
    for (;;) {
      const outcome = await this.attempt(seat, 'clue', async (ctx) => {
        const view = buildSpymasterView(this.engine.getState(), team);
        const decision = await seat.player.giveClue(view, ctx);
        this.checkAbort();
        const clue = this.engine.giveClue(team, decision.word, decision.number);
        this.hooks.onClue?.(seat, { ...decision, word: clue.word }, clue.turn);
      });
      if (outcome === 'done') return;
      if (outcome === 'skip') {
        this.engine.skipTurn(team);
        return;
      }
    }
  }

  private async guessStep(team: TeamId): Promise<void> {
    const seat = this.seat(team, 'operative');
    const turnNumber = this.engine.getState().turn.number;
    for (;;) {
      const outcome = await this.attempt(seat, 'guess', async (ctx) => {
        const view = buildOperativeView(this.engine.getState(), team);
        const decision = await seat.player.nextGuess(view, ctx);
        this.checkAbort();
        this.hooks.onGuessDecision?.(seat, decision, turnNumber);
        if (decision.type === 'pass') {
          const state = this.engine.getState();
          if (this.engine.rules.canPass(state)) this.engine.pass(team);
          else throw new RuleViolation('An operative must make at least one guess before passing.');
          return;
        }
        if (seat.player.kind === 'ai') await this.hooks.beforeReveal?.(seat, decision.cardId);
        this.checkAbort();
        const result = this.engine.guess(team, decision.cardId);
        if (seat.player.kind === 'ai' && !result.turnEnded) await this.hooks.pace?.(seat);
      });
      if (outcome === 'done') return;
      if (outcome === 'skip') {
        this.engine.skipTurn(team);
        return;
      }
    }
  }

  /** Run one player action, routing failures to the UI's retry/skip/quit choice. */
  private async attempt(
    seat: Seat,
    action: 'clue' | 'guess',
    body: (ctx: TurnContext) => Promise<void>,
  ): Promise<'done' | 'skip' | 'retry'> {
    const ctx: TurnContext = {
      signal: this.signal,
      status: (activity) => this.hooks.onStatus?.({ seat, activity }),
      say: (text) => this.hooks.onSpeech?.(seat, text),
    };
    ctx.status(seat.player.kind === 'human' ? 'waiting-human' : action === 'clue' ? 'studying' : 'interpreting');
    try {
      await body(ctx);
      return 'done';
    } catch (err) {
      if (this.signal.aborted || err instanceof MatchAborted) throw new MatchAborted();
      // A human's invalid move is rejected by the UI before it gets here; if not, just ask again.
      if (seat.player.kind === 'human' && err instanceof RuleViolation) return 'retry';
      const choice = this.hooks.onError ? await this.hooks.onError(seat, err, action) : 'skip';
      this.checkAbort();
      if (choice === 'quit') throw new MatchAborted();
      return choice === 'skip' ? 'skip' : 'retry';
    }
  }

  private checkAbort(): void {
    if (this.signal.aborted) throw new MatchAborted();
  }
}
