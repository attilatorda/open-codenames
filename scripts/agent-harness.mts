// Dev harness: play real turns where an external agent (e.g. a Claude instance) stands in for the
// language model. The harness renders exactly the prompts the game would send, and feeds the agent's
// replies through the real parser, strategy layer and engine.
//
//   npx tsx scripts/agent-harness.mts init <boardDir>
//   npx tsx scripts/agent-harness.mts spymaster <boardDir>          → writes harness/spy-<turn>/prompt.md
//   npx tsx scripts/agent-harness.mts apply-clue <boardDir>         ← reads harness/spy-<turn>/reply.json, writes harness/op-<turn>/prompt.md
//   npx tsx scripts/agent-harness.mts apply-guesses <boardDir>      ← reads harness/op-<turn>/reply.json
//   npx tsx scripts/agent-harness.mts status <boardDir>
//
// Spymaster folders contain the key; operative folders never do.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GameEngine } from '../src/core/engine/GameEngine';
import { buildOperativeView, buildSpymasterView } from '../src/core/engine/views';
import { getLayout } from '../src/core/board/layouts';
import { AI_PROFILE } from '../src/core/ai/personalities';
import { cluesGiven } from '../src/core/ai/prompts/common';
import { buildSpymasterPrompt } from '../src/core/ai/prompts/spymaster';
import { buildOperativePrompt } from '../src/core/ai/prompts/operative';
import { OperativeReplySchema, SpymasterReplySchema, parseReply } from '../src/core/ai/parse';
import { cluesGivenBy, estimatePace, planClueSize, sampleSize } from '../src/core/ai/strategy/clueSize';
import { evaluateCandidates } from '../src/core/ai/strategy/evaluate';
import { shouldTakeGuess } from '../src/core/ai/strategy/stopping';
import { createRng, deriveSeed } from '../src/core/util/rng';
import type { LLMMessage } from '../src/core/ai/LLMClient';
import type { Card, CardKind, TeamId } from '../src/core/types';

interface Manifest {
  seed: number;
  layoutId: string;
  startingTeam: TeamId;
  cards: { id: number; coord: string; kind: CardKind; concept: string; prompt: string; file: string }[];
}

type Action =
  | { type: 'clue'; team: TeamId; word: string; number: number; intended: string[]; desired: number; reason: string }
  | { type: 'guess'; team: TeamId; cardId: number; reason?: string; confidence?: number }
  | { type: 'pass'; team: TeamId; why: string };

interface HarnessState {
  actions: Action[];
}

const [cmd, boardArg] = process.argv.slice(2);
const boardDir = resolve(boardArg ?? '.samples/board-2026');
const hdir = join(boardDir, 'harness');
const manifest: Manifest = JSON.parse(await readFile(join(boardDir, 'manifest.json'), 'utf8'));
const layout = getLayout(manifest.layoutId);
const statePath = join(hdir, 'state.json');

function newEngine(): GameEngine {
  const cards: Card[] = manifest.cards.map((c) => ({
    id: c.id,
    coord: c.coord,
    kind: c.kind,
    image: { imageId: c.coord, concept: c.concept, source: 'generated' },
    revealed: false,
  }));
  return new GameEngine({ id: `harness-${manifest.seed}`, seed: manifest.seed, layout, cards, startingTeam: manifest.startingTeam });
}

function replay(state: HarnessState): GameEngine {
  const e = newEngine();
  for (const a of state.actions) {
    if (a.type === 'clue') e.giveClue(a.team, a.word, a.number);
    else if (a.type === 'guess') e.guess(a.team, a.cardId);
    else e.pass(a.team);
  }
  return e;
}

/** Render a prompt as a file an agent can follow: images become absolute paths to Read. */
function render(system: string, messages: LLMMessage[], replyPath: string): string {
  const lines = [
    '# Prompt for the language model',
    '',
    `You are standing in for the language model behind an AI player. Follow the SYSTEM PROMPT and answer the USER MESSAGE exactly as that model should. Wherever the user message shows [IMAGE: path], use the Read tool to view that image file — it is the picture at that coordinate. Read ONLY the files listed here. When done, write ONLY the JSON reply (no prose, no code fence) to: ${replyPath}`,
    '',
    '## SYSTEM PROMPT',
    '',
    system,
    '',
    '## USER MESSAGE',
    '',
  ];
  for (const m of messages) {
    for (const p of m.content) {
      if (p.type === 'text') lines.push(p.text);
      else lines.push(`[IMAGE: ${join(boardDir, `${p.imageId}.jpg`)}]`);
    }
  }
  return lines.join('\n');
}

async function load(): Promise<HarnessState> {
  return JSON.parse(await readFile(statePath, 'utf8'));
}
async function save(s: HarnessState): Promise<void> {
  await mkdir(hdir, { recursive: true });
  await writeFile(statePath, JSON.stringify(s, null, 2));
}

function board(e: GameEngine): string {
  const s = e.getState();
  const rows: string[] = [];
  for (let r = 0; r < layout.rows; r++) {
    rows.push(
      s.cards
        .slice(r * layout.cols, (r + 1) * layout.cols)
        .map((c) => {
          const k = c.kind === 'ASSASSIN' ? 'X' : c.kind[0];
          return `${c.coord}:${c.revealed ? `[${k}]` : ` ${k.toLowerCase()} `}`;
        })
        .join(' '),
    );
  }
  const rem = e.remaining();
  return `${rows.join('\n')}\nAurora (A) needs ${rem.A}, Red (B) needs ${rem.B} · phase=${s.phase} · turn ${s.turn.number} (${s.turn.team})${s.winner ? ` · WINNER ${s.winner} (${s.winReason})` : ''}`;
}

switch (cmd) {
  case 'init': {
    await save({ actions: [] });
    console.log(`Initialized.\n${board(newEngine())}`);
    break;
  }
  case 'status': {
    const st = await load();
    console.log(board(replay(st)));
    for (const a of st.actions) console.log(JSON.stringify(a));
    break;
  }
  case 'spymaster': {
    const st = await load();
    const e = replay(st);
    const s = e.getState();
    if (s.phase !== 'clue') throw new Error(`Not a clue phase (${s.phase})`);
    const team = s.turn.team;
    const view = buildSpymasterView(s, team);
    const personality = AI_PROFILE;
    const plan = planClueSize({
      mode: 'auto',
      myRemaining: view.remaining[team],
      oppRemaining: view.remaining[view.opponent],
      cluesGiven: cluesGivenBy(view.history, team),
      opponentPace: estimatePace(view.history, view.opponent),
      risk: personality.risk,
      situational: personality.situational,
    });
    const desired = sampleSize(plan.distribution, createRng(deriveSeed(manifest.seed, `turn-${s.turn.number}`)));
    const prompt = buildSpymasterPrompt({ view, personality, desiredSize: desired, sizeReason: plan.reason, candidateCount: 4, teammateNotes: [] });
    const dir = join(hdir, `spy-${s.turn.number}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'prompt.md'), render(prompt.system, prompt.messages, join(dir, 'reply.json')));
    await writeFile(join(dir, 'plan.json'), JSON.stringify({ team, desired, plan }, null, 2));
    console.log(`Spymaster prompt for team ${team} (aim ${desired}: ${plan.reason}) → ${join(dir, 'prompt.md')}`);
    break;
  }
  case 'apply-clue': {
    const st = await load();
    const e = replay(st);
    const s = e.getState();
    const team = s.turn.team;
    const dir = join(hdir, `spy-${s.turn.number}`);
    const { desired, plan } = JSON.parse(await readFile(join(dir, 'plan.json'), 'utf8'));
    const reply = parseReply(SpymasterReplySchema, await readFile(join(dir, 'reply.json'), 'utf8'));
    const view = buildSpymasterView(s, team);
    const personality = AI_PROFILE;
    const evaluated = evaluateCandidates(reply.candidates, view, {
      desiredSize: desired,
      risk: personality.risk,
      situational: personality.situational,
      validate: (w, n) => e.rules.validateClue(w, n, view.remaining[team]),
      usedWords: cluesGiven(view.history),
    });
    for (const c of evaluated) {
      console.log(`  ${c.rejected ? '✗' : '•'} ${c.word.padEnd(14)} ${c.targets.map((t) => t.coord).join(',').padEnd(14)} score=${Number.isFinite(c.score) ? c.score.toFixed(2) : '—'} ${c.rejected ?? ''} ${c.why ?? ''}`);
    }
    const best = evaluated.find((c) => !c.rejected);
    if (!best) throw new Error('No legal clue');
    e.giveClue(team, best.word, best.targets.length);
    st.actions.push({ type: 'clue', team, word: best.word, number: best.targets.length, intended: best.targets.map((t) => t.coord), desired, reason: plan.reason });
    await save(st);
    console.log(`\nCLUE (${team}): "${best.word.toUpperCase()}" ${best.targets.length} — intended ${best.targets.map((t) => `${t.coord} (${manifest.cards[t.id].concept})`).join('; ')}`);

    // Operative prompt: built from the operative view only (no key, no picture descriptions).
    const after = e.getState();
    const op = buildOperativePrompt({ view: buildOperativeView(after, team), clue: after.turn.clue!, personality: AI_PROFILE, notes: [] });
    const odir = join(hdir, `op-${after.turn.number}`);
    await mkdir(odir, { recursive: true });
    await writeFile(join(odir, 'prompt.md'), render(op.system, op.messages, join(odir, 'reply.json')));
    console.log(`Operative prompt → ${join(odir, 'prompt.md')}`);
    break;
  }
  case 'apply-guesses': {
    const st = await load();
    const e = replay(st);
    const s = e.getState();
    const team = s.turn.team;
    const reply = parseReply(OperativeReplySchema, await readFile(join(hdir, `op-${s.turn.number}`, 'reply.json'), 'utf8'));
    const personality = AI_PROFILE;
    const clue = s.turn.clue!;
    const intended = (st.actions.filter((a) => a.type === 'clue').at(-1) as Extract<Action, { type: 'clue' }>).intended;
    if (reply.interpretation) console.log(`Operative reads it as: ${reply.interpretation}`);
    let made = 0;
    for (const g of reply.guesses) {
      const now = e.getState();
      if (now.turn.team !== team || now.phase !== 'guess') break;
      const card = now.cards.find((c) => c.coord === g.card && !c.revealed);
      if (!card) continue;
      const d = shouldTakeGuess({
        index: made,
        confidence: g.confidence,
        clueNumber: clue.number,
        myRemaining: e.remaining()[team],
        oppRemaining: e.remaining()[team === 'A' ? 'B' : 'A'],
        baseThreshold: personality.guessThreshold,
        risk: personality.risk,
        situational: personality.situational,
      });
      if (!d.take) {
        e.pass(team);
        st.actions.push({ type: 'pass', team, why: d.why });
        console.log(`  stops before ${card.coord}: ${d.why}`);
        break;
      }
      const r = e.guess(team, card.id);
      made++;
      st.actions.push({ type: 'guess', team, cardId: card.id, reason: g.reason, confidence: g.confidence });
      const label = r.card.kind === team ? 'CORRECT' : r.card.kind === 'NEUTRAL' ? 'neutral' : r.card.kind === 'ASSASSIN' ? 'ASSASSIN' : 'opponent';
      console.log(`  picks ${card.coord} (${Math.round(g.confidence * 100)}%) → ${label}${intended.includes(card.coord) ? ' · as intended' : ''} — ${manifest.cards[card.id].concept} — “${g.reason ?? ''}”`);
      if (r.turnEnded) break;
    }
    const end = e.getState();
    if (end.phase === 'guess' && end.turn.team === team && made > 0) {
      e.pass(team);
      st.actions.push({ type: 'pass', team, why: 'no more picks' });
    }
    await save(st);
    console.log(`\n${board(e)}`);
    break;
  }
  default:
    console.log('commands: init | spymaster | apply-clue | apply-guesses | status');
}
