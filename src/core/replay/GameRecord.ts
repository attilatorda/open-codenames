// Complete, replayable record of a game: board, key, players, clues, guesses and the
// AI reasoning behind them. This is the foundation for replays and a future AI Arena.

import type { CardKind, GameEvent, GameState, Role, TeamId, TurnEndReason, WinReason } from '../types';
import type { ClueDecision, DecisionMeta, GuessDecision, Seat } from '../players/IPlayer';

export const RECORD_VERSION = 1;

export interface PlayerRecord {
  seatId: string;
  team: TeamId;
  role: Role;
  kind: 'human' | 'ai';
  name: string;
  /** Only in records from versions that had several AI personalities. */
  personalityId?: string;
  archetype?: string;
  provider?: string;
  model?: string;
}

export interface GuessRecord {
  coord: string;
  cardId: number;
  kind: CardKind;
  correct: boolean;
  reason?: string;
  confidence?: number;
}

export interface TurnRecord {
  turn: number;
  team: TeamId;
  clue?: {
    word: string;
    number: number;
    intendedTargets?: string[];
    rationale?: string;
    meta?: DecisionMeta;
  };
  guesses: GuessRecord[];
  pass?: { reason?: string; notes?: string };
  endReason?: TurnEndReason;
  speech: { seatId: string; text: string }[];
}

export interface GameRecord {
  version: number;
  id: string;
  modeId: string;
  createdAt: string;
  endedAt?: string;
  seed: number;
  layoutId: string;
  rows: number;
  cols: number;
  styleId?: string;
  startingTeam: TeamId;
  humanTeam?: TeamId;
  cards: { id: number; coord: string; kind: CardKind; imageId: string; concept?: string; source: string }[];
  players: PlayerRecord[];
  turns: TurnRecord[];
  winner?: TeamId;
  winReason?: WinReason;
  aborted?: boolean;
}

export interface RecorderInput {
  state: GameState;
  modeId: string;
  styleId?: string;
  humanTeam?: TeamId;
  players: PlayerRecord[];
}

export class GameRecorder {
  private record: GameRecord;
  private pendingGuess = new Map<number, { reason?: string; confidence?: number }>();

  constructor(input: RecorderInput) {
    const { state } = input;
    this.record = {
      version: RECORD_VERSION,
      id: state.id,
      modeId: input.modeId,
      createdAt: new Date().toISOString(),
      seed: state.seed,
      layoutId: state.layout.id,
      rows: state.layout.rows,
      cols: state.layout.cols,
      styleId: input.styleId,
      startingTeam: state.startingTeam,
      humanTeam: input.humanTeam,
      cards: state.cards.map((c) => ({
        id: c.id,
        coord: c.coord,
        kind: c.kind,
        imageId: c.image.imageId,
        concept: c.image.concept,
        source: c.image.source,
      })),
      players: input.players,
      turns: [],
    };
  }

  private turn(turn: number, team: TeamId): TurnRecord {
    let t = this.record.turns.find((x) => x.turn === turn);
    if (!t) {
      t = { turn, team, guesses: [], speech: [] };
      this.record.turns.push(t);
    }
    return t;
  }

  onClue(seat: Seat, decision: ClueDecision, turn: number, coordOf: (id: number) => string): void {
    this.turn(turn, seat.team).clue = {
      word: decision.word,
      number: decision.number,
      intendedTargets: decision.intendedTargets?.map(coordOf),
      rationale: decision.rationale,
      meta: decision.meta,
    };
  }

  onGuessDecision(seat: Seat, decision: GuessDecision, turn: number): void {
    if (decision.type === 'guess') {
      this.pendingGuess.set(decision.cardId, { reason: decision.reason, confidence: decision.confidence });
    } else {
      this.turn(turn, seat.team).pass = { reason: decision.reason, notes: decision.meta?.notes };
    }
  }

  onSpeech(seat: Seat, text: string, turn: number): void {
    this.turn(turn, seat.team).speech.push({ seatId: seat.id, text });
  }

  onEvent(event: GameEvent): void {
    if (event.type === 'guess') {
      const extra = this.pendingGuess.get(event.cardId);
      this.pendingGuess.delete(event.cardId);
      this.turn(event.turn, event.team).guesses.push({
        coord: event.coord,
        cardId: event.cardId,
        kind: event.kind,
        correct: event.correct,
        ...extra,
      });
    } else if (event.type === 'turnEnd') {
      this.turn(event.turn, event.team).endReason = event.reason;
    } else if (event.type === 'gameOver') {
      this.record.winner = event.winner;
      this.record.winReason = event.reason;
      this.record.endedAt = new Date().toISOString();
    }
  }

  markAborted(): void {
    this.record.aborted = true;
    this.record.endedAt = new Date().toISOString();
  }

  snapshot(): GameRecord {
    return structuredClone(this.record);
  }
}
