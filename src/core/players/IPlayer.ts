import type { GameEvent, Remaining, Role, TeamId } from '../types';
import type { OperativeView, SpymasterView } from '../engine/views';

export type Activity =
  | 'studying' // looking at the board
  | 'thinking-clue'
  | 'weighing' // risk / reward
  | 'simulating' // predicting how the teammate will read a clue
  | 'interpreting' // reading a clue
  | 'deciding'
  | 'waiting-human';

export interface TurnContext {
  signal: AbortSignal;
  /** Update what this player is visibly doing. */
  status(activity: Activity): void;
  /** Public table talk. */
  say(text: string): void;
}

/** Private AI reasoning attached to a decision; hidden from opponents until the debrief. */
export interface DecisionMeta {
  model?: string;
  desiredSize?: number;
  sizeReason?: string;
  sizeDistribution?: Record<number, number>;
  candidates?: {
    clue: string;
    targets: string[];
    score: number;
    rejected?: string;
    why?: string;
  }[];
  latencyMs?: number;
  llmCalls?: number;
  notes?: string;
}

export interface ClueDecision {
  word: string;
  number: number;
  /** Card ids the spymaster meant. Revealed only in the debrief. */
  intendedTargets?: number[];
  /** Spymaster's private explanation. Revealed only in the debrief. */
  rationale?: string;
  meta?: DecisionMeta;
}

export type GuessDecision =
  | { type: 'guess'; cardId: number; reason?: string; confidence?: number; meta?: DecisionMeta }
  | { type: 'pass'; reason?: string; meta?: DecisionMeta };

export interface PublicObservation {
  event: GameEvent;
  remaining: Remaining;
}

export interface IPlayer {
  readonly id: string;
  readonly kind: 'human' | 'ai';
  giveClue(view: SpymasterView, ctx: TurnContext): Promise<ClueDecision>;
  nextGuess(view: OperativeView, ctx: TurnContext): Promise<GuessDecision>;
  /** Called for every public game event, so AI players can build their own memory. */
  observe?(obs: PublicObservation): void;
}

export interface Seat {
  id: string;
  team: TeamId;
  role: Role;
  name: string;
  player: IPlayer;
}
