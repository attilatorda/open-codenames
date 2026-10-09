import type { Activity } from '@core/players/IPlayer';
import { TEAM_NAMES } from '@core/teams';
import type { CardKind, TeamId } from '@core/types';
import type { MatchConfig, SeatConfig } from './matchConfig';

export function kindName(kind: CardKind): string {
  if (kind === 'A' || kind === 'B') return TEAM_NAMES[kind];
  return kind === 'NEUTRAL' ? 'Neutral' : 'Assassin';
}

export function kindClass(kind: CardKind): string {
  return kind === 'A' ? 'green' : kind === 'B' ? 'red' : kind === 'NEUTRAL' ? 'neutral' : 'assassin';
}

export function teamClass(team: TeamId): string {
  return team === 'A' ? 'green' : 'red';
}

/** "Your teammate Ada", "The opposing spymaster Bruno", or "Green's spymaster Clara" when spectating. */
export function who(seat: SeatConfig, config: MatchConfig): string {
  if (seat.kind === 'human') return 'You';
  if (config.spectator || !config.humanTeam) return `${TEAM_NAMES[seat.team]}’s ${seat.role} ${seat.name}`;
  if (seat.team === config.humanTeam) return `Your teammate ${seat.name}`;
  return `The opposing ${seat.role} ${seat.name}`;
}

/** The status-bar line for whoever is acting. */
export function describeActivity(seat: SeatConfig, activity: Activity, config: MatchConfig, humanGaveClue: boolean): string {
  if (seat.kind === 'human') return seat.role === 'spymaster' ? 'You must give a clue' : 'You must pick a picture';
  const w = who(seat, config);
  const teammate = config.seats.find((s) => s.team === seat.team && s.role !== seat.role);
  switch (activity) {
    case 'waiting-human':
      return `${seat.name} will give a clue for`;
    case 'studying':
      return `${w} is studying the board`;
    case 'thinking-clue':
      return `${w} is thinking of a clue`;
    case 'weighing':
      return `${w} is weighing the options`;
    case 'simulating':
      return `${w} is checking how ${teammate?.kind === 'human' ? 'you' : teammate?.name ?? 'its teammate'} will read it`;
    case 'interpreting':
      return humanGaveClue ? `${w} is reading your clue` : `${w} is reading the clue`;
    case 'deciding':
      return `${w} is choosing a picture`;
    default:
      return `${w} is thinking`;
  }
}

export function winLine(winner: TeamId, reason: 'assassin' | 'all-found', humanTeam?: TeamId): { title: string; sub: string } {
  const loser: TeamId = winner === 'A' ? 'B' : 'A';
  const title = humanTeam ? (winner === humanTeam ? 'Victory' : 'Defeat') : `${TEAM_NAMES[winner]} wins`;
  const sub =
    reason === 'assassin'
      ? `${TEAM_NAMES[loser]} revealed the assassin.`
      : `${TEAM_NAMES[winner]} found all of its pictures.`;
  return { title, sub };
}
