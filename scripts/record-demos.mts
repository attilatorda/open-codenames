// Records two ~30-second demo videos of the game (1920×1080 MP4 with captions) for social posts.
// It plays the debug web build in headless Chrome with the offline mock AI, captures frames over the
// DevTools screencast and encodes them with ffmpeg (must be on PATH).
//
//   npm run demos                       → release/demos/open-codenames-demo-1-operative.mp4, …-2-spymaster.mp4
//   npx tsx scripts/record-demos.mts 2  → only demo 2
//
// The human's moves are scripted: the script reads the board from the page and picks clues and
// guesses by word association over the deck's picture descriptions (the same lexicon as the mock AI).
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { mockBrainReply } from '../src/core/ai/mockBrain';
import { AI_PROFILE } from '../src/core/ai/personalities';
import { buildOperativePrompt } from '../src/core/ai/prompts/operative';
import { buildSpymasterPrompt } from '../src/core/ai/prompts/spymaster';
import type { OperativeView, SpymasterView } from '../src/core/engine/views';
import type { CardKind } from '../src/core/types';
import type { DeckManifest } from '../src/shared/deck';
import { DISCLAIMER_VERSION, defaultSettings } from '../src/shared/settings';
import { serve } from './static-server.mjs';

const root = process.cwd();
const outDir = join(root, 'release', 'demos');
const only = process.argv[2];
const WIDTH = 1440;
const HEIGHT = 810;
const SCALE = 4 / 3; // 1440×810 CSS px → 1920×1080 video
const BAND = 92; // caption band under the game, in CSS px

const deck = JSON.parse(await readFile(join(root, 'resources', 'decks', 'grandville', 'deck.json'), 'utf8')) as DeckManifest;
const captions = new Map(deck.cards.map((c) => [`decks/${deck.id}/${c.file}`, c.caption]));
const captionOf = (id: string) => captions.get(id);

type CardState = { coord: string; imageId: string; revealed: boolean; kind?: string; secret?: string };
const KIND: Record<string, CardKind> = { green: 'A', red: 'B', neutral: 'NEUTRAL', assassin: 'ASSASSIN' };

// ───────────────────────── Overlay: captions, cursor, title cards ─────────────────────────

const DEMO_CSS = `
  #root { height: calc(100vh - ${BAND}px) !important; }
  .site-debug, .toast { display: none !important; }
  #demo-band { position: fixed; left: 0; right: 0; bottom: 0; height: ${BAND}px; z-index: 900; background: #1d1f24;
    display: flex; align-items: center; justify-content: center; padding: 0 40px; }
  #demo-caption { color: #fff; font: 500 26px/1.3 Roboto, Arial, sans-serif; text-align: center; transition: opacity .3s; }
  #demo-caption.hidden { opacity: 0; }
  #demo-cursor { position: fixed; z-index: 950; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
    background: rgba(72, 113, 182, .35); border: 3px solid #4871b6; pointer-events: none;
    transition: left .5s cubic-bezier(.3,.8,.3,1), top .5s cubic-bezier(.3,.8,.3,1), transform .15s; left: 50%; top: 45%; }
  #demo-cursor.down { transform: scale(.7); background: rgba(72, 113, 182, .7); }
  #demo-card { position: fixed; inset: 0; z-index: 1000; background: #1d1f24; color: #fff; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 18px; transition: opacity .5s; font-family: Roboto, Arial, sans-serif; text-align: center; }
  #demo-card.hidden { opacity: 0; pointer-events: none; }
  #demo-card .mark { display: grid; grid-template-columns: repeat(2, 30px); gap: 5px; }
  #demo-card .mark i { width: 30px; height: 30px; border-radius: 5px; }
  #demo-card h1 { margin: 0; font-size: 64px; font-weight: 700; }
  #demo-card p { margin: 0; font-size: 28px; color: #d6d6d6; max-width: 1000px; }
  #demo-card p.small { font-size: 22px; color: #a9a9a9; }
`;

async function installOverlay(page: Page): Promise<void> {
  await page.addStyleTag({ content: DEMO_CSS });
  await page.evaluate(() => {
    const band = document.createElement('div');
    band.id = 'demo-band';
    band.innerHTML = '<div id="demo-caption" class="hidden"></div>';
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    const card = document.createElement('div');
    card.id = 'demo-card';
    card.className = 'hidden';
    document.body.append(band, cursor, card);
  });
}

async function caption(page: Page, text: string): Promise<void> {
  await page.evaluate(async (t) => {
    const el = document.getElementById('demo-caption')!;
    if (!el.classList.contains('hidden')) {
      el.classList.add('hidden');
      await new Promise((r) => setTimeout(r, 300));
    }
    el.textContent = t;
    el.classList.remove('hidden');
  }, text);
}

async function titleCard(page: Page, lines: { title: string; text: string; small?: string } | null): Promise<void> {
  await page.evaluate((l) => {
    const el = document.getElementById('demo-card')!;
    if (!l) return void el.classList.add('hidden');
    el.innerHTML =
      '<div class="mark"><i style="background:#2e8b3d"></i><i style="background:#cdbd97"></i><i style="background:#cdbd97"></i><i style="background:#cc3a2f"></i></div>' +
      `<h1>${l.title}</h1><p>${l.text}</p>${l.small ? `<p class="small">${l.small}</p>` : ''}`;
    el.classList.remove('hidden');
  }, lines);
}

/** Move the visible cursor to an element. */
async function pointAt(page: Page, selector: string, pause = 300): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.evaluate(
    ({ x, y }) => {
      const c = document.getElementById('demo-cursor')!;
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  await page.waitForTimeout(550 + pause);
}

/** Move the cursor out of the way (bottom right of the board). */
async function park(page: Page): Promise<void> {
  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor')!;
    c.style.left = `${window.innerWidth - 330}px`;
    c.style.top = `${window.innerHeight - 150}px`;
  });
}

/** Move the visible cursor to an element, then click it. */
async function clickOn(page: Page, selector: string, opts: { pause?: number } = {}): Promise<void> {
  const target = page.locator(selector).first();
  await target.waitFor({ state: 'visible', timeout: 30_000 });
  const box = (await target.boundingBox())!;
  await page.evaluate(
    ({ x, y }) => {
      const c = document.getElementById('demo-cursor')!;
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  await page.waitForTimeout(550);
  await page.evaluate(() => document.getElementById('demo-cursor')!.classList.add('down'));
  await target.click();
  await page.waitForTimeout(140);
  await page.evaluate(() => document.getElementById('demo-cursor')!.classList.remove('down'));
  await page.waitForTimeout(opts.pause ?? 250);
}

// ───────────────────────── Reading the board and choosing the human's moves ─────────────────────────

async function readBoard(page: Page): Promise<CardState[]> {
  return page.$$eval('.board .card', (els) =>
    els.map((el) => {
      const cls = [...el.classList];
      return {
        coord: (el as HTMLElement).dataset.coord!,
        imageId: el.querySelector('.card-face.front img')!.getAttribute('src')!,
        revealed: el.classList.contains('revealed'),
        kind: cls.find((c) => c.startsWith('kind-'))?.slice(5),
        secret: cls.find((c) => c.startsWith('secret-'))?.slice(7),
      };
    }),
  );
}

function layoutOf(cards: CardState[]) {
  return { rows: new Set(cards.map((c) => c.coord[0])).size, cols: new Set(cards.map((c) => c.coord.slice(1))).size };
}

/** A clue for two of the human team's pictures, chosen by association (like the mock spymaster). */
function chooseClue(cards: CardState[]): { word: string; targets: string[] } {
  const { rows, cols } = layoutOf(cards);
  const secret = cards.map((c, id) => ({ id, coord: c.coord, imageId: c.imageId, revealed: c.revealed, kind: KIND[c.secret ?? c.kind ?? 'neutral'] }));
  const view: SpymasterView = {
    role: 'spymaster',
    team: 'A',
    opponent: 'B',
    rows,
    cols,
    turnNumber: 1,
    activeTeam: 'A',
    phase: 'clue',
    remaining: { A: secret.filter((c) => c.kind === 'A' && !c.revealed).length, B: secret.filter((c) => c.kind === 'B' && !c.revealed).length },
    history: [],
    cards: secret,
  };
  const prompt = buildSpymasterPrompt({ view, personality: AI_PROFILE, desiredSize: 2, sizeReason: 'demo', candidateCount: 4, teammateNotes: [] });
  const reply = JSON.parse(mockBrainReply({ slot: 0, system: prompt.system, messages: prompt.messages, maxTokens: 1400 }, captionOf)) as {
    candidates: { clue: string; targets: { card: string }[] }[];
  };
  const best = reply.candidates.find((c) => c.targets.length === 2) ?? reply.candidates[0];
  return { word: best.clue, targets: best.targets.map((t) => t.card) };
}

/** The human operative's picks for a clue, best first. */
function chooseGuesses(cards: CardState[], word: string, number: number): string[] {
  const { rows, cols } = layoutOf(cards);
  const clue = { word: word.toLowerCase(), number, team: 'A' as const, turn: 1 };
  const view: OperativeView = {
    role: 'operative',
    team: 'A',
    opponent: 'B',
    rows,
    cols,
    turnNumber: 1,
    activeTeam: 'A',
    phase: 'guess',
    remaining: { A: 8, B: 7 },
    history: [],
    cards: cards.map((c, id) => ({ id, coord: c.coord, imageId: c.imageId, revealed: c.revealed, revealedKind: c.revealed && c.kind ? KIND[c.kind] : undefined })),
    currentClue: clue,
    guessesMade: 0,
    maxGuesses: number + 1,
  };
  const prompt = buildOperativePrompt({ view, clue, personality: AI_PROFILE, notes: [] });
  const reply = JSON.parse(mockBrainReply({ slot: 0, system: prompt.system, messages: prompt.messages, maxTokens: 900 }, captionOf)) as {
    guesses: { card: string; confidence: number }[];
  };
  return reply.guesses.map((g) => g.card);
}

// ───────────────────────── Recording ─────────────────────────

interface Frame {
  data: Buffer;
  t: number;
}

async function startRecording(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ data: Buffer.from(f.data, 'base64'), t: f.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  return {
    async stop(): Promise<{ frames: Frame[]; end: number }> {
      const end = Date.now() / 1000;
      await cdp.send('Page.stopScreencast');
      return { frames, end };
    },
  };
}

async function encode(frames: Frame[], end: number, file: string): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'oc-demo-'));
  try {
    const list: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const name = `f${String(i).padStart(5, '0')}.jpg`;
      await writeFile(join(dir, name), frames[i].data);
      const next = i + 1 < frames.length ? frames[i + 1].t : end;
      list.push(`file '${name}'`, `duration ${Math.max(0.001, next - frames[i].t).toFixed(4)}`);
    }
    list.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
    await writeFile(join(dir, 'frames.txt'), list.join('\n'));
    execFileSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'), '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', file],
      { stdio: 'inherit' },
    );
    return end - frames[0].t;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ───────────────────────── Scenarios ─────────────────────────

type Scenario = { id: string; file: string; seed: number; role: 'operative' | 'spymaster'; run: (page: Page) => Promise<void> };

const END_CARD = {
  title: 'Open Codenames',
  text: 'Codenames with pictures, played with AI teammates and opponents.',
  small: 'Bring your own AI key · Windows and browser · itch.io',
};

async function startGame(page: Page, role: 'operative' | 'spymaster', intro: string): Promise<void> {
  await caption(page, intro);
  await clickOn(page, '[data-testid="menu-quick"]', { pause: 400 });
  await clickOn(page, `button:has-text("${role === 'spymaster' ? 'Spymaster — give clues' : 'Operative — guess'}")`, { pause: 200 });
  await clickOn(page, '[data-testid="setup-start"]');
  await page.getByTestId('game').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.board .card-face.front img')].every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0));
}

/** Wait until the human may guess again, or the turn passed back to the clue phase. */
async function waitForTurnEnd(page: Page, maxMs: number): Promise<void> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    if (await page.getByTestId('clue-size-auto').isVisible()) return;
    if (await page.getByTestId('clue-input').isVisible()) return;
    if (await page.getByTestId('game-over').isVisible()) return;
    await page.waitForTimeout(100);
  }
}

const SCENARIOS: Scenario[] = [
  {
    id: '1',
    file: 'open-codenames-demo-1-operative.mp4',
    seed: 7,
    role: 'operative',
    async run(page) {
      await titleCard(page, { title: 'Open Codenames', text: 'Codenames with pictures — and an AI teammate.' });
      await page.waitForTimeout(2600);
      await titleCard(page, null);
      await page.waitForTimeout(400);
      await startGame(page, 'operative', 'You and an AI teammate take on two AI opponents.');

      await page.getByTestId('clue-size-2').waitFor({ timeout: 30_000 });
      await caption(page, 'Before each round, you tell your teammate how many pictures to aim for.');
      await page.waitForTimeout(900);
      await clickOn(page, '[data-testid="clue-size-2"]');
      await park(page);
      await caption(page, 'It studies the pictures and looks for one word that links two of yours.');

      await page.getByTestId('end-turn').waitFor({ timeout: 30_000 });
      const word = (await page.getByTestId('current-clue').innerText()).trim();
      const number = Number(await page.locator('.clue-plate-num').innerText());
      await caption(page, `The clue is ${word} ${number}. Your turn: find the pictures it means.`);
      await page.waitForTimeout(1200);
      const picks = chooseGuesses(await readBoard(page), word, number).slice(0, number);
      for (const coord of picks) {
        if (!(await page.getByTestId('end-turn').isVisible())) break;
        await clickOn(page, `.board .card[data-coord="${coord}"]`, { pause: 150 });
        await clickOn(page, '[data-testid="reveal"]', { pause: 1100 });
      }
      if (await page.getByTestId('end-turn').isVisible()) {
        await caption(page, 'Right picks keep the turn going. Stop while you are ahead.');
        await page.waitForTimeout(700);
        await clickOn(page, '[data-testid="end-turn"]');
      }
      await park(page);
      await caption(page, 'Then the AI opponents play, and explain every pick in the game log.');
      await waitForTurnEnd(page, 9000);
      await page.waitForTimeout(600);
      await titleCard(page, END_CARD);
      await page.waitForTimeout(3200);
    },
  },
  {
    id: '2',
    file: 'open-codenames-demo-2-spymaster.mp4',
    seed: 11,
    role: 'spymaster',
    async run(page) {
      await titleCard(page, { title: 'Open Codenames', text: 'Can an AI read your mind from one word?' });
      await page.waitForTimeout(2600);
      await titleCard(page, null);
      await page.waitForTimeout(400);
      await startGame(page, 'spymaster', 'This time you are the spymaster, with an AI as your operative.');

      await page.getByTestId('clue-input').waitFor({ timeout: 30_000 });
      await caption(page, 'You see the secret key: the green-framed pictures are your team’s.');
      await page.waitForTimeout(2600);
      const clue = chooseClue(await readBoard(page));
      await caption(page, `Give one word that connects two of them: ${clue.word.toUpperCase()}.`);
      for (const coord of clue.targets) await pointAt(page, `.board .card[data-coord="${coord}"]`, 500);
      await clickOn(page, '[data-testid="clue-word"]', { pause: 100 });
      await page.getByTestId('clue-word').pressSequentially(clue.word, { delay: 110 });
      await page.waitForTimeout(400);
      await clickOn(page, '[data-testid="clue-submit"]');
      await park(page);

      await caption(page, 'Your AI teammate looks at the pictures, not at text, and reads your clue…');
      await page.locator('.card.pointing').first().waitFor({ timeout: 30_000 });
      await caption(page, '…then picks, and says out loud why each picture fits.');
      // The Red team's turn starts once Green's operative stops.
      await page.waitForSelector('.player-board.red.active', { timeout: 30_000 });
      await caption(page, 'The opponents answer. No clue is ever used twice.');
      await waitForTurnEnd(page, 9000);
      await page.waitForTimeout(500);
      await titleCard(page, END_CARD);
      await page.waitForTimeout(3200);
    },
  },
];

// ───────────────────────── Main ─────────────────────────

await mkdir(outDir, { recursive: true });
const server = await serve(join(root, 'out', 'web-debug'));
const browser = await chromium.launch({ channel: process.env.OC_BROWSER ?? 'chrome' });
try {
  for (const s of SCENARIOS.filter((x) => !only || x.id === only)) {
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE });
    // A fixed board and fixed player names, so the demo is reproducible.
    await context.addInitScript((seed: number) => {
      let a = seed >>> 0;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }, s.seed);
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    await page.goto(server.url);
    const settings = defaultSettings();
    settings.disclaimerAcceptedVersion = DISCLAIMER_VERSION;
    settings.setupComplete = true;
    settings.llmSlots[0] = { enabled: true, provider: 'mock', model: 'mock-brain', vision: 'auto' };
    settings.gameplay.pace = 'normal';
    settings.gameplay.humanRole = s.role;
    await page.evaluate((v) => localStorage.setItem('oc.settings', v), JSON.stringify(settings));
    await page.reload();
    await page.getByTestId('menu-quick').waitFor();
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll('.game-box-card img')] as HTMLImageElement[];
      return imgs.length === 8 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    });
    await installOverlay(page);
    await titleCard(page, { title: 'Open Codenames', text: '' });
    await page.waitForTimeout(300);

    const rec = await startRecording(page);
    await s.run(page);
    const { frames, end } = await rec.stop();
    const file = join(outDir, s.file);
    const seconds = await encode(frames, end, file);
    console.log(`${file}  ${seconds.toFixed(1)} s, ${frames.length} frames`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
