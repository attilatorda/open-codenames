// Information boundaries. Every player (human UI or AI prompt) receives one of these
// views and nothing else. OperativeView deliberately has no field that can carry the key, and
// no view carries a text description of a picture: players read the pictures themselves.

import type { CardKind, Clue, GameEvent, GameState, Remaining, TeamId } from '../types';
import { otherTeam } from '../types';
import { remainingFor } from '../rules/rules';

/** What anyone at the table can see about a card. */
export interface PublicCard {
  id: number;
  coord: string;
  imageId: string;
  revealed: boolean;
  /** Set only once the card has been revealed. */
  revealedKind?: CardKind;
}

export interface SecretCard extends PublicCard {
  kind: CardKind;
}

/** Public record of the game so far (clues, guesses with revealed kinds, turn ends). */
export type PublicEvent = GameEvent;

interface ViewBase {
  team: TeamId;
  opponent: TeamId;
  rows: number;
  cols: number;
  turnNumber: number;
  activeTeam: TeamId;
  phase: GameState['phase'];
  remaining: Remaining;
  history: PublicEvent[];
}

export interface SpymasterView extends ViewBase {
  role: 'spymaster';
  cards: SecretCard[];
}

export interface OperativeView extends ViewBase {
  role: 'operative';
  cards: PublicCard[];
  currentClue?: Clue;
  guessesMade: number;
  maxGuesses: number;
}

function base(state: GameState, team: TeamId): ViewBase {
  return {
    team,
    opponent: otherTeam(team),
    rows: state.layout.rows,
    cols: state.layout.cols,
    turnNumber: state.turn.number,
    activeTeam: state.turn.team,
    phase: state.phase,
    remaining: remainingFor(state.cards),
    // Events only contain public information (kinds appear only for revealed cards).
    history: structuredClone(state.events),
  };
}

export function buildSpymasterView(state: GameState, team: TeamId): SpymasterView {
  return {
    ...base(state, team),
    role: 'spymaster',
    cards: state.cards.map((c) => ({
      id: c.id,
      coord: c.coord,
      imageId: c.image.imageId,
      revealed: c.revealed,
      revealedKind: c.revealed ? c.kind : undefined,
      kind: c.kind,
    })),
  };
}

export function buildOperativeView(state: GameState, team: TeamId): OperativeView {
  return {
    ...base(state, team),
    role: 'operative',
    // Build each card field by field so no secret property can slip through a spread.
    cards: state.cards.map(
      (c): PublicCard => ({
        id: c.id,
        coord: c.coord,
        imageId: c.image.imageId,
        revealed: c.revealed,
        revealedKind: c.revealed ? c.kind : undefined,
      }),
    ),
    currentClue: state.turn.team === team ? state.turn.clue : undefined,
    guessesMade: state.turn.team === team ? state.turn.guessesMade : 0,
    maxGuesses: state.turn.team === team ? state.turn.maxGuesses : 0,
  };
}

/** Strip a spymaster view down to what its operative would see (used for "simulate my teammate"). */
export function operativeViewFromSpymaster(view: SpymasterView, clue?: Clue): OperativeView {
  return {
    team: view.team,
    opponent: view.opponent,
    rows: view.rows,
    cols: view.cols,
    turnNumber: view.turnNumber,
    activeTeam: view.activeTeam,
    phase: view.phase,
    remaining: { ...view.remaining },
    history: structuredClone(view.history),
    role: 'operative',
    cards: view.cards.map((c) => ({
      id: c.id,
      coord: c.coord,
      imageId: c.imageId,
      revealed: c.revealed,
      revealedKind: c.revealed ? c.revealedKind : undefined,
    })),
    currentClue: clue,
    guessesMade: 0,
    maxGuesses: clue ? clue.number + 1 : 0,
  };
}
