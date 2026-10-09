// Core domain types. Nothing in src/core may import Electron, React or provider code.

export type TeamId = 'A' | 'B';
export type CardKind = 'A' | 'B' | 'NEUTRAL' | 'ASSASSIN';
export type Role = 'spymaster' | 'operative';

export const TEAMS: readonly TeamId[] = ['A', 'B'];

export function otherTeam(team: TeamId): TeamId {
  return team === 'A' ? 'B' : 'A';
}

export interface CardImage {
  /** Id of the image in the local image library. */
  imageId: string;
  /** What the image was generated to depict. Shown in the debrief; never sent to players. */
  concept?: string;
  /** Plain visual description from the library. Never sent to players; only the offline mock reads it. */
  caption?: string;
  source: 'generated' | 'folder' | 'mock' | 'deck';
}

export interface Card {
  id: number;
  /** Grid coordinate such as "B3" (row letter, column number). */
  coord: string;
  /** Secret identity. Never expose this through an OperativeView. */
  kind: CardKind;
  image: CardImage;
  revealed: boolean;
  revealedBy?: TeamId;
  revealedOnTurn?: number;
}

export interface BoardLayout {
  id: string;
  /** Compact display name, columns × rows (e.g. "5×4"). */
  short: string;
  label: string;
  rows: number;
  cols: number;
  /** Cards for the team that moves first. */
  starting: number;
  /** Cards for the team that moves second. */
  other: number;
  neutral: number;
  assassin: number;
}

export interface Clue {
  word: string;
  number: number;
  team: TeamId;
  turn: number;
}

export type GamePhase = 'clue' | 'guess' | 'over';

export interface TurnState {
  team: TeamId;
  /** 1-based, counts every team turn. */
  number: number;
  clue?: Clue;
  guessesMade: number;
  maxGuesses: number;
}

export type TurnEndReason = 'pass' | 'neutral' | 'opponent' | 'limit' | 'skipped';
export type WinReason = 'all-found' | 'assassin';

export type GameEvent =
  | { type: 'clue'; team: TeamId; turn: number; word: string; number: number }
  | {
      type: 'guess';
      team: TeamId;
      turn: number;
      cardId: number;
      coord: string;
      kind: CardKind;
      correct: boolean;
    }
  | { type: 'turnEnd'; team: TeamId; turn: number; reason: TurnEndReason }
  | { type: 'gameOver'; winner: TeamId; reason: WinReason; loser: TeamId };

export interface GameState {
  id: string;
  seed: number;
  layout: BoardLayout;
  cards: Card[];
  startingTeam: TeamId;
  phase: GamePhase;
  turn: TurnState;
  events: GameEvent[];
  winner?: TeamId;
  winReason?: WinReason;
}

export interface Remaining {
  A: number;
  B: number;
}
