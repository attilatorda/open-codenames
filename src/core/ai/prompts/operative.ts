import type { LLMMessage } from '../LLMClient';
import type { OperativeView } from '../../engine/views';
import type { Clue } from '../../types';
import { TEAM_NAMES } from '../../teams';
import type { Personality } from '../personalities';
import { GAME_INTRO, RULES_SUMMARY, boardParts, historyLines, revealedSummary, scoreLine, styleBlock } from './common';

export interface OperativePromptInput {
  view: OperativeView;
  clue: Clue;
  personality: Personality;
  notes: string[];
}

/** Built only from an OperativeView: this prompt cannot contain the secret key. */
export function buildOperativePrompt(input: OperativePromptInput): { system: string; messages: LLMMessage[] } {
  const { view, clue, personality } = input;
  const team = TEAM_NAMES[view.team];
  const system = [
    GAME_INTRO,
    RULES_SUMMARY,
    '',
    styleBlock(personality, 'operative'),
    '',
    `Your role: OPERATIVE for team ${team}. You do NOT know which pictures belong to which team — ` +
      'you must infer it from your spymaster’s clue.',
    'Your interpretation and reasons are said out loud at the table: keep each one short and concrete — ' +
      'name what in the picture matches the clue. No role-play or catchphrases.',
    'Reply with JSON only.',
  ].join('\n');

  const selectable = view.cards.filter((c) => !c.revealed).map((c) => c.coord);
  const myRemaining = view.remaining[view.team];
  const oppRemaining = view.remaining[view.opponent];
  const history = historyLines(view.history, view.team);
  const maxPicks = clue.number + 1;

  const task = [
    `Already revealed (cannot be picked): ${revealedSummary(view.cards, view.team)}`,
    `Selectable pictures: ${selectable.join(', ')}`,
    scoreLine(myRemaining, oppRemaining),
    '',
    'Public clue history:',
    ...(history.length ? history.map((l) => `- ${l}`) : ['- (first turn)']),
    '',
    'Your notes about your spymaster:',
    ...(input.notes.length ? input.notes.map((n) => `- ${n}`) : ['- Nothing yet.']),
    '',
    `CURRENT CLUE from your spymaster: "${clue.word.toUpperCase()}" ${clue.number}`,
    '',
    `Rank the selectable pictures that best fit this clue. Give up to ${maxPicks} picks, best first. ` +
      'For each, "confidence" is 0–1 that it belongs to your team given the clue — be honest: a picture that only fits loosely ' +
      'deserves a low number, and every wrong pick ends the turn. ' +
      'Pictures left over from your team’s earlier clues may also be worth considering.',
    '',
    'Respond with JSON exactly like:',
    '{"interpretation":"one sentence on how you read the clue","guesses":[{"card":"B2","confidence":0.85,"reason":"..."}]}',
  ].join('\n');

  return {
    system,
    messages: [
      {
        role: 'user',
        content: [...boardParts(view.cards, view.rows, view.cols), { type: 'text', text: task }],
      },
    ],
  };
}

export interface SimulationPromptInput {
  view: OperativeView;
  clues: { word: string; number: number }[];
  teammateNotes: string[];
}

/**
 * "How would my teammate read these?" Built from an operative-level view so the
 * prediction is not contaminated by the key.
 */
export function buildSimulationPrompt(input: SimulationPromptInput): { system: string; messages: LLMMessage[] } {
  const { view } = input;
  const system = [
    GAME_INTRO,
    RULES_SUMMARY,
    '',
    'You are predicting how a teammate operative — who cannot see the secret key — would interpret several possible clues.',
    'Think like a typical player reading the pictures, using what is known about this teammate.',
    'Reply with JSON only.',
  ].join('\n');
  const selectable = view.cards.filter((c) => !c.revealed).map((c) => c.coord);
  const task = [
    `Already revealed: ${revealedSummary(view.cards, view.team)}`,
    `Selectable pictures: ${selectable.join(', ')}`,
    '',
    'Known about this teammate:',
    ...(input.teammateNotes.length ? input.teammateNotes.map((n) => `- ${n}`) : ['- Nothing yet.']),
    '',
    'For each clue, list the pictures the operative would most likely pick, in order (as many as the clue number).',
    ...input.clues.map((c) => `- "${c.word.toUpperCase()}" ${c.number}`),
    '',
    'Respond with JSON exactly like:',
    '{"readings":[{"clue":"word","picks":["B2","C4"]}]}',
  ].join('\n');
  return {
    system,
    messages: [
      { role: 'user', content: [...boardParts(view.cards, view.rows, view.cols), { type: 'text', text: task }] },
    ],
  };
}
