import type { Card, CardKind, GameState, Remaining, TeamId } from '../types';
import { otherTeam } from '../types';

export interface ClueValidation {
  ok: boolean;
  /** Normalized clue word when ok. */
  word?: string;
  error?: string;
}

export type GuessOutcome =
  | { result: 'correct'; continueTurn: boolean }
  | { result: 'neutral' }
  | { result: 'opponent' }
  | { result: 'assassin' };

/** Rule variants plug in here; the engine never hard-codes clue or guess rules. */
export interface IRuleSet {
  readonly id: string;
  /** `teamRemaining` is how many of the clue-giving team's cards are still hidden. */
  validateClue(word: string, number: number, teamRemaining: number): ClueValidation;
  maxGuessesFor(number: number): number;
  /** Classify a guess. The engine applies the consequences. */
  outcomeOf(state: GameState, team: TeamId, card: Card, guessesMadeAfter: number): GuessOutcome;
  winnerAfterReveal(state: GameState, guessingTeam: TeamId, revealed: Card): TeamId | undefined;
  canPass(state: GameState): boolean;
}

export const MIN_CLUE_NUMBER = 1;
export const MAX_CLUE_NUMBER = 9;
const WORD_PATTERN = /^\p{L}[\p{L}'’-]*$/u;
const MAX_WORD_LENGTH = 32;

export function remainingFor(cards: readonly Card[]): Remaining {
  let A = 0;
  let B = 0;
  for (const c of cards) {
    if (c.revealed) continue;
    if (c.kind === 'A') A++;
    else if (c.kind === 'B') B++;
  }
  return { A, B };
}

export function kindIsTeam(kind: CardKind, team: TeamId): boolean {
  return kind === team;
}

export class StandardRules implements IRuleSet {
  readonly id = 'standard';

  validateClue(rawWord: string, number: number, teamRemaining: number): ClueValidation {
    const word = rawWord.trim();
    if (!word) return { ok: false, error: 'Enter a clue word.' };
    if (/\s/.test(word)) return { ok: false, error: 'A clue must be a single word.' };
    if (word.length > MAX_WORD_LENGTH) return { ok: false, error: 'That clue word is too long.' };
    if (!WORD_PATTERN.test(word)) {
      return { ok: false, error: 'Use letters only (hyphens and apostrophes are allowed).' };
    }
    if (!Number.isInteger(number) || number < MIN_CLUE_NUMBER || number > MAX_CLUE_NUMBER) {
      return { ok: false, error: `The number must be between ${MIN_CLUE_NUMBER} and ${MAX_CLUE_NUMBER}.` };
    }
    if (number > teamRemaining) {
      return {
        ok: false,
        error: `Your team only has ${teamRemaining} image${teamRemaining === 1 ? '' : 's'} left.`,
      };
    }
    return { ok: true, word: word.toLowerCase() };
  }

  maxGuessesFor(number: number): number {
    return number + 1;
  }

  outcomeOf(state: GameState, team: TeamId, card: Card, guessesMadeAfter: number): GuessOutcome {
    if (card.kind === 'ASSASSIN') return { result: 'assassin' };
    if (card.kind === 'NEUTRAL') return { result: 'neutral' };
    if (card.kind !== team) return { result: 'opponent' };
    return { result: 'correct', continueTurn: guessesMadeAfter < state.turn.maxGuesses };
  }

  winnerAfterReveal(state: GameState, guessingTeam: TeamId, revealed: Card): TeamId | undefined {
    if (revealed.kind === 'ASSASSIN') return otherTeam(guessingTeam);
    const remaining = remainingFor(state.cards);
    // Revealing the opponent's final card hands them the win, even on your own turn.
    if (remaining.A === 0) return 'A';
    if (remaining.B === 0) return 'B';
    return undefined;
  }

  canPass(state: GameState): boolean {
    return state.phase === 'guess' && state.turn.guessesMade >= 1;
  }
}
