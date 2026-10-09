// End-to-end smoke test: drives the built app with the offline mock providers.
// Usage: npm run e2e   (screenshots land in .e2e/)
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const shots = join(process.cwd(), '.e2e');
await rm(shots, { recursive: true, force: true });
await mkdir(shots, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), 'oc-e2e-'));
const cleanup = [];

const env = { ...process.env, OC_DEV_MOCK: '1', OC_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;

// OC_E2E_EXE="release/debug/win-unpacked/Open Codenames Debug.exe" runs the same flow against the packaged debug build.
const packaged = process.env.OC_E2E_EXE;
const app = await electron.launch(packaged ? { executablePath: packaged, args: [], env } : { executablePath: electronPath, args: ['.'], env });
console.log(packaged ? `packaged build: ${packaged}` : 'dev build (out/)');
const page = await app.firstWindow();
await page.setViewportSize?.({ width: 1440, height: 900 }).catch(() => {});
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));

let n = 0;
const shot = async (name) => {
  const file = join(shots, `${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log('screenshot', file);
};
const step = (s) => console.log(`\n▶ ${s}`);

try {
  step('Disclaimer');
  await page.getByText('Important information').waitFor();
  const cont = page.getByRole('button', { name: 'Continue' });
  if (!(await cont.isDisabled())) throw new Error('Continue should be disabled before accepting');
  await shot('disclaimer');
  await page.locator('.disclaimer-actions input[type=checkbox]').check();
  await cont.click();

  step('AI configuration');
  await page.getByText('Connect your AI').waitFor();
  await page.getByTestId('config-continue').click();
  await page.getByRole('alert').waitFor();
  await shot('config-validation');
  await page.getByTestId('use-mock').click();
  await page.getByTestId('llm-test-0').click();
  await page.getByText(/Connected/).first().waitFor();
  await shot('config-ready');
  await page.getByTestId('config-continue').click();

  step('Main menu');
  await page.getByTestId('menu-quick').waitFor();
  await page.evaluate(() => window.oc.settings.update({ gameplay: { pace: 'fast' } }));
  await shot('menu');

  // ── Game 1: human spymaster ──
  step('Quick Play as spymaster');
  await page.getByTestId('menu-quick').click();
  await page.getByRole('button', { name: /Spymaster — give clues/ }).click();
  await page.getByText(/Grandville/).first().waitFor();
  await shot('setup');
  await page.getByTestId('setup-start').click();
  await page.getByTestId('game').waitFor({ timeout: 60_000 });
  // Pictures must actually load through the oc-img:// protocol (and the production CSP).
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('.board .card-face.front img')];
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  }, null, { timeout: 15_000 });
  await playGame('spymaster');
  await shot('game1-over');
  await page.getByTestId('game-over').getByRole('button', { name: 'Debrief' }).click();
  await page.getByTestId('debrief').waitFor();
  await shot('debrief');

  // ── Game 2: human operative ──
  step('Quick Play as operative');
  await page.getByTestId('nav-play').click();
  await page.getByTestId('menu-quick').waitFor();
  await page.waitForTimeout(1500);
  await shot('menu-with-pictures');
  await page.getByTestId('menu-quick').click();
  await page.getByRole('button', { name: /Operative — guess/ }).click();
  await page.getByTestId('setup-start').click();
  await page.getByTestId('game').waitFor({ timeout: 60_000 });
  await playGame('operative');
  await shot('game2-over');
  await page.getByRole('button', { name: 'View board' }).click();
  await shot('game2-board');

  step('Settings, diagnostics, help, play menu');
  await page.getByTestId('pause').click();
  await page.getByTestId('quit-game').click();
  await page.getByTestId('nav-settings').click();
  await shot('settings-gameplay');
  await page.getByRole('tab', { name: 'Diagnostics' }).click();
  await page.waitForTimeout(300);
  await shot('settings-diagnostics');
  await page.getByRole('tab', { name: 'Keys & privacy' }).click();
  await shot('settings-privacy');
  await page.getByTestId('nav-play').click();
  await page.getByTestId('nav-help').click();
  await page.getByRole('tab', { name: 'Playing' }).click();
  await shot('help');
  await page.getByTestId('nav-play').click();
  await page.getByTestId('menu-play').click();
  await shot('play-menu');

  step('AI vs AI (spectator)');
  await page.getByTestId('mode-ai-vs-ai').click();
  await shot('setup-ai-vs-ai');
  await page.getByTestId('setup-start').click();
  await page.getByTestId('game').waitFor({ timeout: 60_000 });
  await page.getByTestId('game-over').waitFor({ timeout: 180_000 });
  await shot('ai-vs-ai-over');

  step('Game history');
  await page.getByTestId('game-over').getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('nav-history').click();
  await page.getByText(/Quick Play/).first().waitFor();
  await shot('history');

  const replays = await page.evaluate(() => window.oc.replays.list());
  console.log(`\nreplays saved: ${replays.length}`);
  if (replays.length < 3) throw new Error('Expected at least 3 saved games');

  // ── Provider failure → friendly error dialog (local server on a closed port; no external calls) ──
  step('Provider failure handling');
  await page.evaluate(async () => {
    const s = await window.oc.settings.get();
    const slots = s.llmSlots.slice();
    slots[1] = { enabled: true, provider: 'local', model: 'test-model', baseUrl: 'http://127.0.0.1:9/v1', vision: 'on' };
    await window.oc.settings.update({ llmSlots: slots });
  });
  await page.getByTestId('nav-play').click();
  await page.getByTestId('menu-quick').click();
  await page.getByRole('button', { name: /Spymaster — give clues/ }).click();
  await page.getByTestId('setup-start').click();
  await page.getByTestId('game').waitFor({ timeout: 60_000 });
  let errorsSeen = 0;
  const failDeadline = Date.now() + 120_000;
  while (errorsSeen < 2 && Date.now() < failDeadline) {
    // The random mock teammate can end the game (e.g. on the assassin) before the second outage.
    if (errorsSeen === 1 && (await page.getByTestId('game-over').isVisible())) {
      await page.getByTestId('game-over').getByRole('button', { name: 'Menu' }).click();
      errorsSeen = 2;
      break;
    }
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible()) {
      const text = await dialog.innerText();
      if (!/Could not reach the local server/.test(text)) throw new Error(`Unexpected error text: ${text}`);
      errorsSeen++;
      if (errorsSeen === 1) {
        await shot('provider-error');
        await dialog.getByRole('button', { name: 'Skip this turn' }).click();
        await page.getByTestId('feed').getByText('Turn skipped.').waitFor();
      } else {
        await dialog.getByRole('button', { name: 'Quit to menu' }).click();
      }
      await dialog.waitFor({ state: 'hidden' });
      continue;
    }
    if (await page.getByTestId('clue-input').isVisible()) {
      await page.getByTestId('clue-word').fill('signal');
      await page.getByTestId('clue-submit').click();
      continue;
    }
    await page.waitForTimeout(150);
  }
  if (errorsSeen < 2) throw new Error('Expected the provider error dialog twice');
  await page.getByTestId('menu-quick').waitFor();

  // ── Delete all saved credentials ──
  step('Delete all keys');
  await page.evaluate(async () => {
    const s = await window.oc.settings.get();
    const slots = s.llmSlots.slice();
    slots[1] = { enabled: false, provider: '', model: '', vision: 'auto' };
    await window.oc.settings.update({ llmSlots: slots });
    await window.oc.credentials.setLLMKey(2, 'sk-e2e-not-a-real-key-1234');
  });
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: 'Keys & privacy' }).click();
  await page.getByText('1 saved').waitFor();
  await page.getByTestId('delete-keys').click();
  await page.getByTestId('confirm-delete').click();
  await page.getByText('0 saved').waitFor();
  const cred = await page.evaluate(() => window.oc.credentials.status());
  if (cred.llm.some((k) => k.hasKey) || cred.image.hasKey) throw new Error('Keys were not deleted');

  // ── No image key: board from the player's picture folder ──
  step('Picture-folder board (no image key)');
  const folder = await mkdtemp(join(tmpdir(), 'oc-pics-'));
  for (let i = 0; i < 18; i++) await writeFile(join(folder, `pic-${i}.png`), solidPng(64, 64, [40 + i * 11, 200 - i * 7, 90 + i * 5]));
  await page.evaluate(async (dir) => {
    await window.oc.images.clearGenerated();
    await window.oc.settings.update({ image: { provider: 'none', model: '', source: 'library', folder: dir }, gameplay: { layoutId: '4x4' } });
    await window.oc.images.rescanFolder();
  }, folder);
  const lib = await page.evaluate(() => window.oc.images.library());
  if (lib.folder !== 18) throw new Error(`Expected 18 folder pictures, got ${JSON.stringify(lib)}`);
  await page.getByTestId('nav-play').click();
  await page.getByTestId('menu-quick').click();
  await page.getByTestId('setup-start').click();
  await page.getByTestId('game').waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll('.board .card-face.front img')];
      return imgs.length === 16 && imgs.every((i) => i.complete && i.naturalWidth === 64);
    },
    null,
    { timeout: 15_000 },
  );
  await shot('folder-board');
  await page.getByTestId('pause').click();
  await page.getByTestId('quit-game').click();
  cleanup.push(folder);

  // ── Standard deck: browse it, then deal a Codenames Pictures board from it ──
  step('Standard deck');
  const decks = await page.evaluate(() => window.oc.images.decks());
  const deck = decks.find((d) => d.id === 'grandville');
  console.log(`standard deck: ${deck.cards.length} cards`);
  if (deck.cards.length < 50) throw new Error(`Expected at least 50 deck cards, got ${deck.cards.length}`);
  if (deck.cards.some((c) => !c.artist || !c.title || !c.year || !c.sourceURL)) throw new Error('Deck card missing credits');
  await page.getByTestId('nav-deck').click();
  await page.getByTestId('deck-grid').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.deck-card img')].slice(0, 12).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 });
  await shot('deck');
  await page.locator('.deck-card').first().click();
  await page.getByRole('dialog').getByText('Artist').waitFor();
  await shot('deck-detail');
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-play').click();
  await page.evaluate(() => window.oc.settings.update({ image: { source: 'deck' }, gameplay: { layoutId: '4x5' } }));
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('nav-play').click();
  await page.getByTestId('menu-quick').click();
  await page.getByText(/Grandville/).first().waitFor();
  await page.getByTestId('setup-start').click();
  await page.getByTestId('game').waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll('.board .card-face.front img')];
      return imgs.length === 20 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    },
    null,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(800);
  await shot('deck-board');
  await page.getByTestId('pause').click();
  await page.getByTestId('quit-game').click();

  // ── Import a collection (with per-picture credits) and make it the standard ──
  step('Import a collection and make it standard');
  const importDir = await mkdtemp(join(tmpdir(), 'oc-collection-'));
  cleanup.push(importDir);
  const csv = ['file,title,artist,year,license'];
  for (let i = 0; i < 22; i++) {
    await writeFile(join(importDir, `painting-${i}.png`), solidPng(80, 80, [200 - i * 6, 60 + i * 7, 120]));
    csv.push(`painting-${i}.png,"Painting no. ${i}",Test Painter,20${10 + (i % 10)},Licensed for testing`);
  }
  await writeFile(join(importDir, 'credits.csv'), csv.join(String.fromCharCode(10)));
  const scan = await page.evaluate((dir) => window.oc.images.scanCollectionFolder(dir), importDir);
  if (scan.images !== 22 || scan.metadata !== 'credits.csv') throw new Error(`Unexpected scan ${JSON.stringify(scan)}`);
  const imported = await page.evaluate(
    (dir) => window.oc.images.importCollection({ folder: dir, name: 'Test Painter collection', artist: '', year: '', source: '', sourceURL: '', license: '' }),
    importDir,
  );
  if (!imported.ok) throw new Error(`Import failed: ${JSON.stringify(imported.error)}`);
  if (imported.data.cards[3].title !== 'Painting no. 3' || imported.data.cards[3].artist !== 'Test Painter') throw new Error('Credits not applied');
  await page.getByTestId('nav-deck').click();
  await page.getByTestId(`collection-${imported.data.id}`).click();
  await page.getByTestId('make-standard').click();
  await page.getByText(/Standard collection — Quick Play deals from it/).waitFor();
  await shot('collections');
  await page.getByTestId('nav-play').click();
  await page.getByTestId('menu-quick').click();
  await page.waitForFunction((id) => document.querySelector('[data-testid="setup-collection"]')?.value === id, imported.data.id);
  await page.getByTestId('setup-start').click();
  await page.getByTestId('game').waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll('.board .card-face.front img')];
      return imgs.length === 20 && imgs.every((i) => i.complete && i.naturalWidth === 80);
    },
    null,
    { timeout: 15_000 },
  );
  // Zoom the board in and out.
  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-in').click();
  await page.waitForTimeout(300);
  await shot('board-zoomed');
  const zoomLabel = await page.locator('.zoom-level').innerText();
  if (zoomLabel !== '150%') throw new Error(`Expected 150% zoom, got ${zoomLabel}`);
  await page.locator('.zoom-level').click();
  await page.getByTestId('pause').click();
  await page.getByTestId('quit-game').click();
  await page.evaluate((id) => window.oc.images.removeCollection(id), imported.data.id);
  const after = await page.evaluate(() => window.oc.settings.get());
  if (after.image.deckId !== 'grandville') throw new Error('Removing the standard collection should fall back to Grandville');

  // ── Generated pictures (developer placeholder generator: abstract shapes, no text) ──
  step('Generated-picture pipeline');
  await page.evaluate(() => window.oc.settings.update({ image: { provider: 'mock', model: 'placeholder', source: 'generate' } }));
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('nav-play').click();
  await page.getByTestId('menu-quick').click();
  await page.getByTestId('setup-start').click();
  await page.getByText('Generating pictures').waitFor();
  await page.waitForTimeout(400);
  await shot('generating');
  await page.getByTestId('game').waitFor({ timeout: 60_000 });
  await page.getByTestId('pause').click();
  await page.getByTestId('quit-game').click();
  await page.evaluate(() => window.oc.settings.update({ image: { provider: 'none', model: '', source: 'deck' } }));
} catch (err) {
  await shot('failure').catch(() => {});
  console.error('\nE2E FAILED:', err);
  process.exitCode = 1;
} finally {
  if (errors.length) {
    console.log('\nRenderer errors:');
    for (const e of errors) console.log(' ', e);
  }
  await app.close();
  for (const dir of [userData, ...cleanup]) await rm(dir, { recursive: true, force: true });
}

/** Minimal solid-color PNG encoder (for test pictures). */
function solidPng(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Play until the game ends, acting whenever the human is asked to. */
async function playGame(role) {
  const words = ['journey', 'light', 'storm', 'memory', 'gold', 'night', 'water', 'magic', 'spark', 'echo', 'royal', 'wild'];
  let turns = 0;
  let shotMid = false;
  let shotSize = false;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId('game-over').isVisible()) return;
    // Before each clue from the AI teammate, the human operative picks its clue size.
    if (role === 'operative' && (await page.getByTestId('clue-size-auto').isVisible())) {
      if (!shotSize) {
        await shot('game2-clue-size');
        shotSize = true;
      }
      const sizes = ['auto', '1', '2', '3'];
      await page.getByTestId(`clue-size-${sizes[turns % sizes.length]}`).click();
      continue;
    }
    if (role === 'spymaster' && (await page.getByTestId('clue-input').isVisible())) {
      if (!shotMid) {
        await shot('game1-spymaster-turn');
        // Invalid clue first: should be rejected in the UI.
        await page.getByTestId('clue-word').fill('two words');
        await page.getByTestId('clue-submit').click();
        await page.getByText('A clue must be a single word.').waitFor();
        await shot('game1-invalid-clue');
      }
      await page.getByTestId('clue-word').fill(words[turns % words.length]);
      await page.getByTestId('clue-submit').click();
      turns++;
      if (!shotMid) {
        await page.waitForTimeout(700);
        await shot('game1-ai-guessing');
        shotMid = true;
      }
      continue;
    }
    if (role === 'operative' && (await page.getByTestId('end-turn').isVisible())) {
      const endTurn = page.getByTestId('end-turn');
      if (!(await endTurn.isDisabled()) && Math.random() < 0.35) {
        await endTurn.click();
        continue;
      }
      const tiles = page.locator('.board .card.selectable');
      const count = await tiles.count();
      if (count === 0) {
        await page.waitForTimeout(100);
        continue;
      }
      const tile = tiles.nth(Math.floor(Math.random() * count));
      await tile.click();
      if (!shotMid) {
        await shot('game2-operative-select');
      }
      await page.getByTestId('reveal').click();
      turns++;
      if (!shotMid) {
        await page.waitForTimeout(900);
        await shot('game2-after-reveal');
        shotMid = true;
      }
      continue;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`Game did not finish in time (${turns} human actions)`);
}
