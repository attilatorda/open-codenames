import type { LLMContentPart } from '../LLMClient';
import type { PublicCard, PublicEvent } from '../../engine/views';
import type { TeamId } from '../../types';
import { TEAM_NAMES } from '../../teams';
import type { Personality } from '../personalities';

export const GAME_INTRO =
  'You are playing Open Codenames — a Codenames-style party game played with PICTURES instead of words. ' +
  'Two teams (Green and Red) race to find their own pictures on a shared grid. ' +
  'Each team has a spymaster, who sees a secret key, and an operative, who does not.';

/** The rules every player is told. `assassins` > 0 when the assassin option is on. */
export function rulesSummary(assassins: number): string {
  return (
    'Rules: a clue is exactly ONE word plus a number (how many of the team’s pictures relate to the word). ' +
    'The operative then picks pictures one at a time, up to the number plus one. ' +
    'Picking a team picture lets them continue; a neutral picture ends the turn; ' +
    'an opponent picture gives the opponents a point and ends the turn. ' +
    (assassins > 0
      ? 'One picture is the ASSASSIN: the team that reveals it loses the game immediately, so never risk a picture that could be it. '
      : '') +
    'The first team to reveal all its pictures wins.'
  );
}

export function styleBlock(p: Personality, forRole: 'spymaster' | 'operative'): string {
  return [
    forRole === 'spymaster' ? `Clue style: ${p.clueStyle}` : `Reading style: ${p.guessStyle}`,
    `Relationships you favor: ${p.relations.join(', ')}.`,
  ].join('\n');
}

/**
 * Board pictures in a fixed order (stable prefix for prompt caching). Players always look at the
 * pictures themselves; no text description of a picture is ever sent.
 */
export function boardParts(cards: readonly PublicCard[], rows: number, cols: number): LLMContentPart[] {
  const parts: LLMContentPart[] = [
    {
      type: 'text',
      text:
        `The board has ${rows} rows (letters A–${String.fromCharCode(64 + rows)}, top to bottom) and ${cols} columns (numbers 1–${cols}, left to right). ` +
        'Each picture below is preceded by its coordinate. Judge every picture by what you see in it.',
    },
  ];
  for (const c of cards) {
    parts.push({ type: 'text', text: `Picture ${c.coord}:` });
    parts.push({ type: 'image', imageId: c.imageId });
  }
  return parts;
}

/** Every clue word given so far this game, by either team, oldest first. */
export function cluesGiven(history: readonly PublicEvent[]): string[] {
  return history.filter((e): e is Extract<PublicEvent, { type: 'clue' }> => e.type === 'clue').map((e) => e.word.toLowerCase());
}

export function revealedSummary(cards: readonly PublicCard[], viewer: TeamId): string {
  const revealed = cards.filter((c) => c.revealed && c.revealedKind);
  if (revealed.length === 0) return 'Nothing has been revealed yet.';
  return revealed
    .map((c) => {
      const k = c.revealedKind!;
      const label =
        k === 'NEUTRAL' ? 'neutral' : k === 'ASSASSIN' ? 'assassin' : k === viewer ? 'your team' : 'opponents';
      return `${c.coord} = ${label}`;
    })
    .join(', ');
}

/** Human-readable public history, grouped by turn. */
export function historyLines(history: readonly PublicEvent[], viewer: TeamId, maxTurns = 12): string[] {
  const turns = new Map<number, { team: TeamId; clue?: string; picks: string[]; end?: string }>();
  for (const e of history) {
    if (e.type === 'gameOver') continue;
    const t = turns.get(e.turn) ?? { team: e.team, picks: [] };
    if (e.type === 'clue') t.clue = `"${e.word}" ${e.number}`;
    if (e.type === 'guess') {
      const k = e.kind === 'NEUTRAL' ? 'neutral' : e.kind === 'ASSASSIN' ? 'ASSASSIN' : e.kind === viewer ? 'your team' : 'opponents';
      t.picks.push(`${e.coord} (${k}${e.correct ? ', correct' : ''})`);
    }
    if (e.type === 'turnEnd') t.end = e.reason;
    turns.set(e.turn, t);
  }
  const lines: string[] = [];
  for (const [turn, t] of [...turns.entries()].slice(-maxTurns)) {
    const who = t.team === viewer ? `your team (${TEAM_NAMES[t.team]})` : `opponents (${TEAM_NAMES[t.team]})`;
    const picks = t.picks.length ? t.picks.join(', ') : 'no picks yet';
    lines.push(`Turn ${turn}, ${who}: clue ${t.clue ?? '(none — turn skipped)'} → ${picks}`);
  }
  return lines;
}

export function scoreLine(myRemaining: number, oppRemaining: number): string {
  return `Score: your team still needs ${myRemaining} picture${myRemaining === 1 ? '' : 's'}; the opponents need ${oppRemaining}.`;
}
