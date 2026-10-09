// Game-mode registry. A mode decides who sits where; the engine and rules are shared.

import type { Role, TeamId } from '../types';

export interface SeatSpec {
  team: TeamId;
  role: Role;
  kind: 'human' | 'ai';
  /** Which configured LLM slot (index into the enabled slots list) drives this AI. */
  slot?: number;
}

export interface SeatDefaults {
  humanRole: Role;
  /** Enabled LLM slot indexes, in order. */
  slots: number[];
}

export interface GameModeDef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  available: boolean;
  /** Human-on-board modes hide the key from operatives; spectator modes may show it. */
  spectator?: boolean;
  defaultSeats?(d: SeatDefaults): SeatSpec[];
}

function slotAt(slots: number[], i: number): number {
  return slots.length ? slots[i % slots.length] : 0;
}

const quickPlay: GameModeDef = {
  id: 'quick',
  name: 'Quick Play',
  tagline: 'You + AI teammate vs two AIs',
  description: 'You and an AI teammate against two AI opponents.',
  available: true,
  defaultSeats(d) {
    const aiRole: Role = d.humanRole === 'spymaster' ? 'operative' : 'spymaster';
    return [
      { team: 'A', role: d.humanRole, kind: 'human' },
      { team: 'A', role: aiRole, kind: 'ai', slot: slotAt(d.slots, 0) },
      { team: 'B', role: 'spymaster', kind: 'ai', slot: slotAt(d.slots, 1) },
      { team: 'B', role: 'operative', kind: 'ai', slot: slotAt(d.slots, 2) },
    ];
  },
};

const standard: GameModeDef = {
  id: 'standard',
  name: 'Standard',
  tagline: 'Pick every seat yourself',
  description: 'Choose your seat and which language model plays each AI seat.',
  available: true,
  defaultSeats: quickPlay.defaultSeats,
};

const aiVsAi: GameModeDef = {
  id: 'ai-vs-ai',
  name: 'AI vs AI',
  tagline: 'Watch two AI teams compete',
  description: 'Four AI players, two teams. Pit different models against each other.',
  available: true,
  spectator: true,
  defaultSeats(d) {
    return [
      { team: 'A', role: 'spymaster', kind: 'ai', slot: slotAt(d.slots, 0) },
      { team: 'A', role: 'operative', kind: 'ai', slot: slotAt(d.slots, 1) },
      { team: 'B', role: 'spymaster', kind: 'ai', slot: slotAt(d.slots, 2) },
      { team: 'B', role: 'operative', kind: 'ai', slot: slotAt(d.slots, 3) },
    ];
  },
};

const comingSoon = (id: string, name: string, tagline: string, description: string): GameModeDef => ({
  id,
  name,
  tagline,
  description,
  available: false,
});

export const GAME_MODES: readonly GameModeDef[] = [
  quickPlay,
  standard,
  aiVsAi,
  comingSoon('human-vs-ai', 'Human vs AI', 'Head to head with a machine', 'A direct duel between you and an AI.'),
  comingSoon('2h-vs-2ai', '2 Humans vs 2 AI', 'Couch co-op against the machines', 'Two people share a screen against an AI team.'),
  comingSoon('prompt-battle', 'Prompt Battle', 'Generate the strongest image', 'Compete to generate the image that best captures a concept.'),
  comingSoon('blind-prompt', 'Blind Prompt', 'Guess the prompt', 'Given an image, infer the concept behind it.'),
  comingSoon('caption-battle', 'Caption Battle', 'Best caption wins', 'Write the best caption for an image.'),
  comingSoon('impostor', 'Impostor', 'Find the odd one out', 'Spot the image that does not belong.'),
  comingSoon('semantic-bluff', 'Semantic Bluff', 'Mislead, defensibly', 'Clues designed to mislead while staying defensible.'),
  comingSoon('turing', 'Turing Mode', 'Human or machine?', 'Work out which moves came from humans and which from AI.'),
];

export function getMode(id: string): GameModeDef {
  return GAME_MODES.find((m) => m.id === id) ?? quickPlay;
}
