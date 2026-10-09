import type { CardKind, TeamId } from './types';

/** Display names; the code uses A/B everywhere. */
export const TEAM_NAMES: Record<TeamId, string> = { A: 'Green', B: 'Red' };

export function kindLabel(kind: CardKind, viewer?: TeamId): string {
  if (kind === 'NEUTRAL') return 'neutral';
  if (kind === 'ASSASSIN') return 'ASSASSIN';
  if (!viewer) return TEAM_NAMES[kind];
  return kind === viewer ? `yours (${TEAM_NAMES[kind]})` : `opponent's (${TEAM_NAMES[kind]})`;
}
