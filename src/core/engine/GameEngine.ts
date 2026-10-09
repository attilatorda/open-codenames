import type { Card, Clue, GameEvent, GameState, TeamId, TurnEndReason } from '../types';
import { otherTeam } from '../types';
import type { BoardLayout } from '../types';
import { StandardRules, type IRuleSet, remainingFor } from '../rules/rules';

export class RuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}

export interface NewGameInput {
  id: string;
  seed: number;
  layout: BoardLayout;
  cards: Card[];
  startingTeam: TeamId;
}

export type EngineListener = (state: GameState, event: GameEvent | null) => void;

export interface GuessResult {
  card: Card;
  correct: boolean;
  turnEnded: boolean;
  gameOver: boolean;
}

/**
 * The single authority on game state. Players propose actions; only the engine
 * validates and applies them.
 */
export class GameEngine {
  private state: GameState;
  private readonly listeners = new Set<EngineListener>();

  constructor(
    input: NewGameInput,
    readonly rules: IRuleSet = new StandardRules(),
  ) {
    this.state = {
      id: input.id,
      seed: input.seed,
      layout: input.layout,
      cards: input.cards.map((c) => ({ ...c, image: { ...c.image }, revealed: false })),
      startingTeam: input.startingTeam,
      phase: 'clue',
      turn: { team: input.startingTeam, number: 1, guessesMade: 0, maxGuesses: 0 },
      events: [],
    };
  }

  /** Snapshot copy; callers can never mutate engine state. */
  getState(): GameState {
    return structuredClone(this.state);
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  giveClue(team: TeamId, word: string, number: number): Clue {
    const s = this.state;
    if (s.phase !== 'clue') throw new RuleViolation('It is not time to give a clue.');
    if (s.turn.team !== team) throw new RuleViolation('It is not your team’s turn.');
    const v = this.rules.validateClue(word, number, remainingFor(s.cards)[team]);
    if (!v.ok) throw new RuleViolation(v.error ?? 'Invalid clue.');
    const clue: Clue = { word: v.word!, number, team, turn: s.turn.number };
    s.turn.clue = clue;
    s.turn.guessesMade = 0;
    s.turn.maxGuesses = this.rules.maxGuessesFor(number);
    s.phase = 'guess';
    this.emit({ type: 'clue', team, turn: s.turn.number, word: clue.word, number });
    return clue;
  }

  guess(team: TeamId, cardId: number): GuessResult {
    const s = this.state;
    if (s.phase !== 'guess') throw new RuleViolation('It is not time to guess.');
    if (s.turn.team !== team) throw new RuleViolation('It is not your team’s turn.');
    if (s.turn.guessesMade >= s.turn.maxGuesses) throw new RuleViolation('No guesses left this turn.');
    const card = s.cards.find((c) => c.id === cardId);
    if (!card) throw new RuleViolation('That image is not on the board.');
    if (card.revealed) throw new RuleViolation('That image has already been revealed.');

    card.revealed = true;
    card.revealedBy = team;
    card.revealedOnTurn = s.turn.number;
    s.turn.guessesMade++;
    const outcome = this.rules.outcomeOf(s, team, card, s.turn.guessesMade);
    const correct = outcome.result === 'correct';
    this.emit({
      type: 'guess',
      team,
      turn: s.turn.number,
      cardId: card.id,
      coord: card.coord,
      kind: card.kind,
      correct,
    });

    const winner = this.rules.winnerAfterReveal(s, team, card);
    if (winner) {
      this.finish(winner, card.kind === 'ASSASSIN' ? 'assassin' : 'all-found');
      return { card: { ...card }, correct, turnEnded: true, gameOver: true };
    }

    let endReason: TurnEndReason | undefined;
    if (outcome.result === 'neutral') endReason = 'neutral';
    else if (outcome.result === 'opponent') endReason = 'opponent';
    else if (outcome.result === 'correct' && !outcome.continueTurn) endReason = 'limit';
    if (endReason) this.endTurn(endReason);
    return { card: { ...card }, correct, turnEnded: !!endReason, gameOver: false };
  }

  pass(team: TeamId): void {
    const s = this.state;
    if (s.turn.team !== team) throw new RuleViolation('It is not your team’s turn.');
    if (!this.rules.canPass(s)) throw new RuleViolation('You must make at least one guess first.');
    this.endTurn('pass');
  }

  /** Recovery path when a player cannot act (e.g. an AI provider is down). */
  skipTurn(team: TeamId): void {
    const s = this.state;
    if (s.phase === 'over') return;
    if (s.turn.team !== team) throw new RuleViolation('It is not your team’s turn.');
    this.endTurn('skipped');
  }

  private endTurn(reason: TurnEndReason): void {
    const s = this.state;
    const team = s.turn.team;
    const turn = s.turn.number;
    s.turn = { team: otherTeam(team), number: turn + 1, guessesMade: 0, maxGuesses: 0 };
    s.phase = 'clue';
    this.emit({ type: 'turnEnd', team, turn, reason });
  }

  private finish(winner: TeamId, reason: 'assassin' | 'all-found'): void {
    const s = this.state;
    s.phase = 'over';
    s.winner = winner;
    s.winReason = reason;
    this.emit({ type: 'gameOver', winner, reason, loser: otherTeam(winner) });
  }

  remaining() {
    return remainingFor(this.state.cards);
  }

  private emit(event: GameEvent): void {
    this.state.events.push(event);
    const snapshot = this.getState();
    for (const l of this.listeners) l(snapshot, event);
  }
}
