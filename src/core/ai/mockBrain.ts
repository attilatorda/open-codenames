// Offline stand-in for a language model. It reads the same prompts a real model gets and
// answers with plausible JSON. Used by unit tests and the developer-only mock provider.
//
// The mock cannot look at pictures, so whoever runs it swaps each picture for its library
// description (the mock provider does this; tools pass `captionOf`). With descriptions it plays by
// word association: clues are words shared by its team's pictures, and guesses are the pictures
// whose description suggests the clue. Without descriptions it falls back to seeded random play.
// Like a real player it never repeats a clue already given this game.

import type { LLMRequest } from './LLMClient';
import { MOCK_LEXICON } from './mockLexicon';
import { createRng, type Rng } from '../util/rng';

const WORDS = [
  'journey', 'light', 'storm', 'silence', 'memory', 'gold', 'flight', 'shadow', 'ocean', 'winter',
  'music', 'secret', 'fire', 'dream', 'machine', 'garden', 'night', 'speed', 'sweet', 'ancient',
  'wild', 'glass', 'circus', 'royal', 'lonely', 'magic', 'water', 'spark', 'hidden', 'echo',
];

/** Words too vague (or too grammatical) to make a fair clue. */
const STOP = new Set(
  (
    'the and with its his her their into onto from over under that this whose which while for are has have was ' +
    'one two three four five some very made like each other out off top side back front its own who what ' +
    'man men woman women lady gentleman person people animal animals creature figure picture scene ' +
    'wearing dressed holding standing sitting small large big giant tiny old young little tall long ' +
    'pair group full half part made using way thing things'
  ).split(' '),
);

const ADJECTIVES = new Set(
  (
    'enormous huge strange odd great wild long tall thin short fat seated suspended elegant grand fine ' +
    'curious funny tiny strange several many another strangely other various vast heavy light dark'
  ).split(' '),
);

/** Words good enough to be clues: the lexicon's association vocabulary (mostly concrete nouns and themes). */
const CLUE_VOCAB = new Set(
  Object.values(MOCK_LEXICON)
    .flatMap((v) => v.split(' '))
    .map(stem),
);

function lastUserText(req: LLMRequest, captionOf?: (imageId: string) => string | undefined): string {
  const last = [...req.messages].reverse().find((m) => m.role === 'user');
  return (last?.content ?? []).map((p) => (p.type === 'text' ? p.text : (captionOf?.(p.imageId) ?? ''))).join('\n');
}

/** Clue words the prompt says were already given this game. */
function usedClues(text: string): Set<string> {
  const line = text.split('\n').find((l) => l.startsWith('Clues already used'));
  const list = line ? line.slice(line.indexOf(':') + 1) : '';
  return new Set(
    list
      .split(',')
      .map((w) => stem(w.trim().toLowerCase()))
      .filter((w) => w && w !== 'none'),
  );
}

function coordsAfter(label: RegExp, text: string): string[] {
  const line = text.split('\n').find((l) => label.test(l));
  if (!line) return [];
  return [...line.replace(label, '').matchAll(/\b([A-H][1-9])\b/g)].map((m) => m[1]);
}

/** Picture descriptions found in the prompt, by coordinate. */
function pictureNotes(text: string): Map<string, string> {
  const notes = new Map<string, string>();
  for (const m of text.matchAll(/Picture ([A-H][1-9]):[ \t]*\n?[ \t]*([^\n]*)/g)) {
    const caption = m[2].trim();
    if (caption && !caption.startsWith('(') && !caption.startsWith('Picture ')) notes.set(m[1], caption);
  }
  // Spymaster key notes: A1 ("a chameleon on a twig")
  for (const m of text.matchAll(/\b([A-H][1-9]) \("([^"]+)"\)/g)) if (!notes.has(m[1])) notes.set(m[1], m[2]);
  return notes;
}

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

interface Profile {
  /** Words in the description itself. */
  own: Set<string>;
  /** Words the description suggests. */
  assoc: Set<string>;
  display: Map<string, string>;
}

function profileOf(caption: string | undefined): Profile {
  const profile: Profile = { own: new Set(), assoc: new Set(), display: new Map() };
  if (!caption) return profile;
  const add = (set: Set<string>, word: string) => {
    // Adverbs and descriptive adjectives make poor clues ("impossibly", "enormous").
    if (word.length < 3 || STOP.has(word) || ADJECTIVES.has(word) || word.endsWith('ly') || !/^[a-z]+$/.test(word)) return;
    const s = stem(word);
    set.add(s);
    if (!profile.display.has(s)) profile.display.set(s, word);
  };
  const lower = caption.toLowerCase();
  for (const w of lower.match(/[a-z][a-z'-]*/g) ?? []) for (const part of w.split('-')) add(profile.own, part);
  const key = lower.replace(/[.\s]+$/, '').trim();
  for (const w of (MOCK_LEXICON[key] ?? '').split(' ')) if (w) add(profile.assoc, w);
  return profile;
}

/** How strongly a picture suggests the word (0 = not at all). */
function fit(p: Profile, word: string): number {
  const s = stem(word.toLowerCase());
  if (p.own.has(s)) return 0.85;
  if (p.assoc.has(s)) return 0.72;
  if (s.length >= 5) for (const w of [...p.own, ...p.assoc]) if (w.length >= 5 && (w.startsWith(s) || s.startsWith(w))) return 0.5;
  return 0;
}

function shortCaption(caption: string): string {
  const c = caption.replace(/\.$/, '');
  const lower = c.charAt(0).toLowerCase() + c.slice(1);
  return lower.length > 70 ? `${lower.slice(0, 67).trimEnd()}…` : `${lower}.`;
}

/** Rank the selectable pictures for a clue by how well their descriptions fit it. */
function rankForClue(word: string, selectable: string[], notes: Map<string, string>, rng: Rng) {
  return rng
    .shuffle(selectable)
    .map((coord) => ({ coord, caption: notes.get(coord), score: fit(profileOf(notes.get(coord)), word) }))
    .sort((a, b) => b.score - a.score);
}

export function mockBrainReply(req: LLMRequest, captionOf?: (imageId: string) => string | undefined): string {
  const text = lastUserText(req, captionOf);
  const seedText = text.length + (req.purpose ?? '').length + req.messages.length;
  const rng = createRng(hash(text) ^ seedText);
  const notes = pictureNotes(text);

  if (text.includes('"readings"')) {
    const selectable = coordsAfter(/^Selectable pictures:/, text);
    const clues = [...text.matchAll(/^- "([A-Z'’-]+)" (\d)/gm)].map((m) => ({ word: m[1].toLowerCase(), n: Number(m[2]) }));
    return JSON.stringify({
      readings: clues.map((c) => ({
        clue: c.word,
        picks: notes.size ? rankForClue(c.word, selectable, notes, rng).slice(0, c.n).map((r) => r.coord) : rng.shuffle(selectable).slice(0, c.n),
      })),
    });
  }

  if (text.includes('"candidates"')) {
    const mine = coordsAfter(/^- Your team \([A-Za-z]+\), \d+ left:/, text);
    const opponents = coordsAfter(/^- Opponents \([A-Za-z]+\), \d+ left:/, text);
    const neutral = coordsAfter(/^- Neutral:/, text);
    const assassin = coordsAfter(/^- ASSASSIN \(instant loss\):/, text);
    const desired = Number(text.match(/aim to connect about (\d)/)?.[1] ?? 2);
    const used = usedClues(text);
    const associative = notes.size ? associativeCandidates(mine, opponents, neutral, assassin, notes, desired, used) : [];
    if (associative.length) return JSON.stringify({ candidates: associative });

    const danger = [...opponents, ...neutral, ...assassin];
    const words = rng.shuffle(WORDS.filter((w) => !used.has(stem(w))));
    const candidates = [desired, Math.max(1, desired - 1), desired + 1, 1].map((size, i) => {
      const targets = rng.shuffle(mine).slice(0, Math.max(1, Math.min(size, mine.length)));
      return {
        clue: words[i],
        targets: targets.map((card) => ({ card, strength: Math.round((0.5 + rng.next() * 0.45) * 100) / 100 })),
        risks: rng.shuffle(danger).slice(0, 1).map((card) => ({ card, level: Math.round(rng.next() * 40) / 100 })),
        why: `The pictures all share a sense of ${words[i]}.`,
      };
    });
    return JSON.stringify({ candidates });
  }

  if (text.includes('"guesses"')) {
    const selectable = coordsAfter(/^Selectable pictures:/, text);
    const clueMatch = text.match(/CURRENT CLUE from your spymaster: "([^"]+)" (\d)/);
    const word = (clueMatch?.[1] ?? '').toLowerCase();
    const n = Number(clueMatch?.[2] ?? 1);
    if (notes.size) {
      const ranked = rankForClue(word, selectable, notes, rng).slice(0, n + 1);
      const matched = ranked.filter((r) => r.score > 0).length;
      return JSON.stringify({
        interpretation: matched ? `Looking for pictures linked to ${word.toUpperCase()}.` : `${word.toUpperCase()} is hard to place on this board.`,
        guesses: ranked.map((r, i) => ({
          card: r.coord,
          confidence: r.score > 0 ? Math.round((r.score - i * 0.03) * 100) / 100 : 0.15,
          reason: r.score > 0 && r.caption ? `It shows ${shortCaption(r.caption)}` : 'Only a weak link — a guess.',
        })),
      });
    }
    const picks = rng.shuffle(selectable).slice(0, n + 1);
    return JSON.stringify({
      interpretation: `Looking for pictures linked to ${word.toUpperCase()}.`,
      guesses: picks.map((card, i) => ({
        card,
        confidence: Math.round((0.85 - i * 0.18) * 100) / 100,
        reason: i === 0 ? 'The closest match I can see.' : 'This could fit too.',
      })),
    });
  }

  return '{"error":"unrecognized prompt"}';
}

/** Clue candidates made of words that several of the team's pictures suggest and few others do. */
function associativeCandidates(
  mine: string[],
  opponents: string[],
  neutral: string[],
  assassin: string[],
  notes: Map<string, string>,
  desired: number,
  alreadyGiven: Set<string>,
) {
  const profiles = new Map([...mine, ...opponents, ...neutral, ...assassin].map((c) => [c, profileOf(notes.get(c))]));
  const words = new Map<string, string>();
  for (const c of mine) for (const [s, display] of profiles.get(c)!.display) if (!words.has(s)) words.set(s, display);
  // Prefer real concepts; fall back to any description word only on boards the lexicon does not know.
  const vocab = [...words.keys()].filter((s) => CLUE_VOCAB.has(s));
  if (vocab.length) for (const s of [...words.keys()]) if (!CLUE_VOCAB.has(s)) words.delete(s);
  for (const s of alreadyGiven) words.delete(s);

  const options = [...words.entries()].map(([s, display]) => {
    const targets = mine
      .map((card) => ({ card, strength: fit(profiles.get(card)!, s) }))
      .filter((t) => t.strength > 0)
      .sort((a, b) => b.strength - a.strength);
    const risks = [
      ...opponents.map((card) => ({ card, level: fit(profiles.get(card)!, s) * 0.9 })),
      ...neutral.map((card) => ({ card, level: fit(profiles.get(card)!, s) * 0.8 })),
      ...assassin.map((card) => ({ card, level: fit(profiles.get(card)!, s) })),
    ].filter((r) => r.level > 0);
    const danger = risks.reduce((sum, r) => sum + r.level * (assassin.includes(r.card) ? 4 : opponents.includes(r.card) ? 1.5 : 1), 0);
    return { display, targets, risks, danger };
  });

  const chosen: { clue: string; targets: { card: string; strength: number }[]; risks: { card: string; level: number }[]; why: string }[] = [];
  const used = new Set<string>();
  for (const size of [desired, desired - 1, desired + 1, 1, 2]) {
    if (size < 1 || chosen.length >= 4) continue;
    const best = options
      .filter((o) => !used.has(o.display) && o.targets.length >= size)
      .map((o) => {
        const targets = o.targets.slice(0, size);
        const value = targets.reduce((sum, t) => sum + t.strength, 0) - o.danger;
        return { ...o, targets, value };
      })
      .sort((a, b) => b.value - a.value)[0];
    if (!best || best.value <= 0) continue;
    used.add(best.display);
    chosen.push({
      clue: best.display,
      targets: best.targets,
      risks: best.risks.map((r) => ({ card: r.card, level: Math.round(r.level * 100) / 100 })),
      why: best.targets.map((t) => `${t.card} shows ${shortCaption(notes.get(t.card) ?? '').replace(/\.$/, '')}`).join('; ') + '.',
    });
  }
  return chosen;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
