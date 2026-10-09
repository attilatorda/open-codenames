import type { Card, TeamId } from '@core/types';
import type { GameRecord } from '@core/replay/GameRecord';
import type { SlotInfo } from '@shared/ipc';
import type { MatchConfig } from '../game/matchConfig';

export interface BoardReady {
  cards: Card[];
  startingTeam: TeamId;
  /** LLM slot capabilities at the time the board was built. */
  slots: SlotInfo[];
}

export type Screen =
  | { name: 'boot' }
  | { name: 'disclaimer'; review?: boolean }
  | { name: 'config'; first: boolean }
  | { name: 'menu' }
  | { name: 'play' }
  | { name: 'setup'; modeId: string }
  | { name: 'loading'; config: MatchConfig }
  | { name: 'game'; config: MatchConfig; board: BoardReady }
  | { name: 'debrief'; record: GameRecord; config?: MatchConfig }
  | { name: 'settings'; tab?: string }
  | { name: 'help'; tab?: string }
  | { name: 'history' }
  | { name: 'deck' };
