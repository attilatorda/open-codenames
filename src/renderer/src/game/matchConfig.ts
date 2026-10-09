import type { ClueSizeMode } from '@core/ai/strategy/clueSize';
import { getLayout, withAssassin } from '@core/board/layouts';
import { getMode, type SeatSpec } from '@core/modes/gameModes';
import type { BoardLayout, Role, TeamId } from '@core/types';
import { createRng, randomSeed } from '@core/util/rng';
import type { SlotInfo } from '@shared/ipc';
import type { Settings } from '@shared/settings';

export interface SeatConfig extends SeatSpec {
  id: string;
  name: string;
}

export interface MatchConfig {
  id: string;
  modeId: string;
  seed: number;
  layoutId: string;
  styleId: string;
  conceptSet: Settings['gameplay']['conceptSet'];
  /** One neutral picture becomes the assassin (revealing it loses the game). */
  assassin: boolean;
  /** Picture collection to deal from when imageSource is 'deck'. */
  deckId: string;
  seats: SeatConfig[];
  humanTeam?: TeamId;
  humanRole?: Role;
  spectator: boolean;
  /** Preselected answer when the human picks their AI teammate's clue size. */
  clueSize: ClueSizeMode;
  riskBias: number;
  pace: Settings['gameplay']['pace'];
  imageSource: 'deck' | 'generate' | 'library';
}

/** Table names for AI players; each game seats a different few. */
const AI_NAMES = ['Ada', 'Bruno', 'Clara', 'Dario', 'Elsa', 'Felix', 'Greta', 'Hugo', 'Iris', 'Jonas', 'Kira', 'Lars'];

export function newGameId(): string {
  return `g-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function nextHumanRole(settings: Settings): Role {
  const pref = settings.gameplay.humanRole;
  if (pref !== 'alternate') return pref;
  return settings.gameplay.lastHumanRole === 'spymaster' ? 'operative' : 'spymaster';
}

export function readySlots(slots: SlotInfo[]): number[] {
  return slots.filter((s) => s.ready).map((s) => s.slot);
}

/** Give every seat an id and a display name. */
export function nameSeats(specs: SeatSpec[], seed: number): SeatConfig[] {
  const names = createRng(seed).shuffle(AI_NAMES);
  let next = 0;
  return specs.map((s) => {
    const id = `${s.team}-${s.role}`;
    return { ...s, id, name: s.kind === 'human' ? 'You' : names[next++ % names.length] };
  });
}

export function imageSourceFor(settings: Settings): MatchConfig['imageSource'] {
  // Generating needs an image provider; without one the standard deck is used.
  if (settings.image.source === 'generate' && settings.image.provider === 'none') return 'deck';
  return settings.image.source ?? 'deck';
}

export function buildMatchConfig(
  modeId: string,
  settings: Settings,
  slots: SlotInfo[],
  overrides: Partial<{
    humanRole: Role;
    seats: SeatSpec[];
    layoutId: string;
    styleId: string;
    conceptSet: Settings['gameplay']['conceptSet'];
    deckId: string;
  }> = {},
): MatchConfig {
  const mode = getMode(modeId);
  const humanRole = overrides.humanRole ?? nextHumanRole(settings);
  const specs = overrides.seats ?? mode.defaultSeats!({ humanRole, slots: readySlots(slots) });
  const seed = randomSeed();
  const seats = nameSeats(specs, seed);
  const human = seats.find((s) => s.kind === 'human');
  return {
    id: newGameId(),
    modeId: mode.id,
    seed,
    layoutId: overrides.layoutId ?? settings.gameplay.layoutId,
    styleId: overrides.styleId ?? settings.gameplay.styleId,
    conceptSet: overrides.conceptSet ?? settings.gameplay.conceptSet ?? 'surreal',
    assassin: !!settings.gameplay.assassin,
    deckId: overrides.deckId ?? settings.image.deckId ?? 'grandville',
    seats,
    humanTeam: human?.team,
    humanRole: human?.role,
    spectator: !human,
    clueSize: settings.gameplay.clueSize,
    riskBias: settings.gameplay.riskBias,
    pace: settings.gameplay.pace,
    imageSource: imageSourceFor(settings),
  };
}

/** The board layout for a match, with the assassin when that option is on. */
export function matchLayout(config: MatchConfig): BoardLayout {
  const base = getLayout(config.layoutId);
  return config.assassin ? withAssassin(base) : base;
}

/** Same seats with the human's role swapped (and the AI teammate taking the other role). */
export function swappedRoles(config: MatchConfig): MatchConfig {
  if (!config.humanTeam) return { ...config, id: newGameId(), seed: randomSeed() };
  const seats = config.seats.map((s) =>
    s.team === config.humanTeam ? { ...s, role: (s.role === 'spymaster' ? 'operative' : 'spymaster') as Role, id: `${s.team}-${s.role === 'spymaster' ? 'operative' : 'spymaster'}` } : s,
  );
  return {
    ...config,
    id: newGameId(),
    seed: randomSeed(),
    seats,
    humanRole: config.humanRole === 'spymaster' ? 'operative' : 'spymaster',
  };
}

export const PACE_MS: Record<Settings['gameplay']['pace'], number> = { relaxed: 1500, normal: 950, fast: 420 };
