import type { LLMMessage } from '../LLMClient';
import type { SecretCard, SpymasterView } from '../../engine/views';
import { TEAM_NAMES } from '../../teams';
import type { Personality } from '../personalities';
import { GAME_INTRO, boardParts, cluesGiven, historyLines, revealedSummary, scoreLine, styleBlock, rulesSummary } from './common';

export interface SpymasterPromptInput {
  view: SpymasterView;
  personality: Personality;
  desiredSize: number;
  sizeReason: string;
  candidateCount: number;
  teammateNotes: string[];
}

export function buildSpymasterPrompt(input: SpymasterPromptInput): { system: string; messages: LLMMessage[] } {
  const { view, personality } = input;
  const team = TEAM_NAMES[view.team];
  const system = [
    GAME_INTRO,
    rulesSummary(view.assassins),
    '',
    styleBlock(personality, 'spymaster'),
    '',
    `Your role: SPYMASTER for team ${team}. You can see the secret key. ` +
      'Your teammate (the operative) sees only the pictures and your clue.',
    'Clue rules: exactly one word (a hyphenated compound is fine), connected to what is visible in the pictures — ' +
      'objects, animals, clothing, actions, setting, mood. Never refer to coordinates, positions, letters or card colors.',
    'Clue quality: use a common English word that a typical player would connect to EVERY target within a few seconds of looking at the pictures. ' +
      'No puns that need explaining, invented words, obscure trivia or private associations. ' +
      'Never repeat a clue that has already been given this game. ' +
      'A clear clue for fewer pictures beats a vague clue for more.',
    'Your objective is to maximize your team’s chance of winning the game, not to connect as many pictures as possible.',
    'Reply with JSON only.',
  ].join('\n');

  const unrevealed = view.cards.filter((c) => !c.revealed);
  const list = (pred: (c: SecretCard) => boolean) =>
    unrevealed
      .filter(pred)
      .map((c) => c.coord)
      .join(', ') || 'none';

  const myRemaining = view.remaining[view.team];
  const oppRemaining = view.remaining[view.opponent];
  const lo = Math.max(1, input.desiredSize - 1);
  const hi = Math.min(myRemaining, input.desiredSize + 1);
  const history = historyLines(view.history, view.team);
  const used = [...new Set(cluesGiven(view.history))];

  const task = [
    'SECRET KEY — pictures still hidden:',
    `- Your team (${team}), ${myRemaining} left: ${list((c) => c.kind === view.team)}`,
    `- Opponents (${TEAM_NAMES[view.opponent]}), ${oppRemaining} left: ${list((c) => c.kind === view.opponent)}`,
    `- Neutral: ${list((c) => c.kind === 'NEUTRAL')}`,
    // Only the assassin option deals an assassin; the standard game has none.
    ...(view.cards.some((c) => c.kind === 'ASSASSIN') ? [`- ASSASSIN (instant loss): ${list((c) => c.kind === 'ASSASSIN')}`] : []),
    '',
    `Already revealed (cannot be picked again): ${revealedSummary(view.cards, view.team)}`,
    scoreLine(myRemaining, oppRemaining),
    '',
    'Clue history:',
    ...(history.length ? history.map((l) => `- ${l}`) : ['- (first turn)']),
    `Clues already used (do not repeat any of them): ${used.length ? used.map((w) => w.toUpperCase()).join(', ') : 'none'}`,
    '',
    'What you have learned about your teammate:',
    ...(input.teammateNotes.length ? input.teammateNotes.map((n) => `- ${n}`) : ['- Nothing yet.']),
    '',
    `Game-engine strategy guidance: ${input.sizeReason}. This turn, aim to connect about ${input.desiredSize} picture${input.desiredSize === 1 ? '' : 's'} (acceptable range ${lo}–${hi}).`,
    '',
    `Task: propose ${input.candidateCount} different candidate clues. Include at least one that connects exactly ${Math.min(input.desiredSize, myRemaining)}, ` +
      'and others of neighboring sizes when the board allows. For each candidate give:',
    '- "clue": the single word',
    '- "targets": your team’s hidden pictures it points to, each with "strength" 0–1 = how likely your teammate links that picture to the clue',
    '- "risks": hidden pictures that are NOT your team’s which your teammate might pick for this clue, each with "level" 0–1. Be honest — every wrong pick ends the turn, and an opponent picture hands them a point.',
    '- "why": one short sentence naming what in each target picture matches the clue',
    '',
    'Respond with JSON exactly like:',
    '{"candidates":[{"clue":"word","targets":[{"card":"A1","strength":0.9}],"risks":[{"card":"C3","level":0.2}],"why":"..."}]}',
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
