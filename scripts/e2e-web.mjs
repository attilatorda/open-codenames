// End-to-end smoke test of the browser build (debug flavor, mock AI) in headless Chrome.
// Usage: npm run e2e:web   (screenshots land in .e2e-web/)
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from './static-server.mjs';

const shots = join(process.cwd(), '.e2e-web');
await rm(shots, { recursive: true, force: true });
await mkdir(shots, { recursive: true });

const server = await serve(join(process.cwd(), 'out', 'web-debug'));
const browser = await chromium.launch({ channel: process.env.OC_BROWSER ?? 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`console: ${m.text()}`));
page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));

let n = 0;
const shot = async (name) => {
  const file = join(shots, `${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log('screenshot', file);
};
const step = (s) => console.log(`\n▶ ${s}`);
const imagesLoaded = (count) =>
  page.waitForFunction(
    (c) => {
      const imgs = [...document.querySelectorAll('.board .card-face.front img')];
      return imgs.length === c && imgs.every((i) => i.complete && i.naturalWidth > 0);
    },
    count,
    { timeout: 15_000 },
  );

try {
  step('First run');
  await page.goto(server.url);
  await page.getByText('Your keys stay in this browser').waitFor();
  await shot('disclaimer');
  await page.locator('.disclaimer-actions input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Connect your AI').waitFor();
  if (await page.getByText('Your picture folder').count()) throw new Error('The web build should not offer picture folders');
  const companies = await page.getByTestId('llm-provider-0').locator('option').allInnerTexts();
  if (companies.some((c) => /Local LLM/.test(c))) throw new Error('The web build should not offer local servers');
  await page.getByTestId('use-mock').click();
  await page.getByTestId('llm-test-0').click();
  await page.getByText(/Connected/).first().waitFor();
  await shot('config');
  await page.getByTestId('config-continue').click();
  await page.getByTestId('menu-quick').waitFor();
  await page.evaluate(() => window.oc.settings.update({ gameplay: { pace: 'fast' } }));
  await page.waitForFunction(() => [...document.querySelectorAll('.game-box-card img')].length === 8);
  await shot('menu');

  step('Quick Play as spymaster');
  await page.getByTestId('menu-quick').click();
  await page.getByRole('button', { name: /Spymaster — give clues/ }).click();
  await page.getByTestId('setup-start').click();
  await page.getByTestId('game').waitFor({ timeout: 30_000 });
  await imagesLoaded(20);
  await play('spymaster');
  await shot('game-over');
  await page.getByTestId('game-over').getByRole('button', { name: 'Debrief' }).click();
  await page.getByTestId('debrief').waitFor();
  await shot('debrief');

  step('Reload keeps settings and history');
  await page.reload();
  await page.getByTestId('menu-quick').waitFor();
  await page.getByTestId('nav-history').click();
  await page.getByText(/Quick Play/).first().waitFor();
  await shot('history');

  step('Quick Play as operative (clue size asked in game)');
  await page.getByTestId('nav-play').click();
  await page.getByTestId('menu-quick').click();
  await page.getByRole('button', { name: /Operative — guess/ }).click();
  await page.getByTestId('setup-start').click();
  await page.getByTestId('game').waitFor({ timeout: 30_000 });
  await imagesLoaded(20);
  await play('operative', 2);
  await shot('operative');
  await page.getByTestId('pause').click();
  await page.getByTestId('quit-game').click();

  step('Desktop-only features are hidden');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: 'Pictures' }).click();
  if (await page.getByText('Generate new pictures').count()) throw new Error('Picture generation should be hidden on the web');
  await page.getByRole('tab', { name: 'Keys & privacy' }).click();
  await page.getByText(/local storage for this site/).waitFor();
  await page.getByTestId('nav-deck').click();
  await page.getByTestId('deck-grid').waitFor();
  if (await page.getByTestId('import-collection').count()) throw new Error('Import should be hidden on the web');
  await page.waitForFunction(() => [...document.querySelectorAll('.deck-card img')].slice(0, 8).every((i) => i.complete && i.naturalWidth > 0));
  await shot('deck');

  step('A real provider receives the pictures as images (Anthropic, faked API)');
  const seen = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers });
    if (req.url().includes('/v1/models')) {
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' }) });
    }
    seen.push(JSON.parse(req.postData() ?? '{}'));
    return route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }),
    });
  });
  const result = await page.evaluate(async () => {
    const s = await window.oc.settings.get();
    const slots = s.llmSlots.slice();
    slots[1] = { enabled: true, provider: 'anthropic', model: 'claude-opus-5-5', vision: 'auto' };
    await window.oc.settings.update({ llmSlots: slots });
    await window.oc.credentials.setLLMKey(1, 'sk-ant-e2e-not-a-real-key-000000');
    const test = await window.oc.llm.test(1);
    const deck = (await window.oc.images.decks())[0];
    const res = await window.oc.llm.complete('e2e-1', {
      slot: 1,
      system: 'test',
      maxTokens: 50,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Picture A1:' }, { type: 'image', imageId: deck.cards[0].imageId }, { type: 'text', text: 'Reply.' }] }],
    });
    return { test, res };
  });
  if (!result.test.ok) throw new Error(`Connection test failed: ${JSON.stringify(result.test)}`);
  if (!result.res.ok) throw new Error(`Completion failed: ${JSON.stringify(result.res)}`);
  const image = seen[0]?.messages?.[0]?.content?.find((p) => p.type === 'image');
  if (!image || image.source?.media_type !== 'image/jpeg' || (image.source?.data?.length ?? 0) < 2000) {
    throw new Error(`Expected a JPEG image block, got ${JSON.stringify(image)?.slice(0, 200)}`);
  }
  console.log(`image sent to the provider: ${image.source.media_type}, ${image.source.data.length} base64 chars`);
} catch (err) {
  await shot('failure').catch(() => {});
  console.error('\nE2E (web) FAILED:', err);
  process.exitCode = 1;
} finally {
  if (errors.length) {
    console.log('\nPage errors:');
    for (const e of errors) console.log(' ', e);
    if (errors.some((e) => e.startsWith('pageerror'))) process.exitCode = 1;
  }
  await browser.close();
  await server.close();
}

/** Act whenever the human is asked to, until the game ends (or `turns` human turns). */
async function play(role, turns = Infinity) {
  const words = ['journey', 'light', 'storm', 'memory', 'gold', 'night', 'water', 'magic', 'spark', 'echo', 'royal', 'wild'];
  let done = 0;
  let guessed = 0;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline && done < turns) {
    if (await page.getByTestId('game-over').isVisible()) return;
    if (role === 'operative' && (await page.getByTestId('clue-size-auto').isVisible())) {
      await page.getByTestId('clue-size-2').click();
      continue;
    }
    if (role === 'spymaster' && (await page.getByTestId('clue-input').isVisible())) {
      await page.getByTestId('clue-word').fill(words[done % words.length]);
      await page.getByTestId('clue-submit').click();
      done++;
      continue;
    }
    if (role === 'operative' && (await page.getByTestId('end-turn').isVisible())) {
      const tiles = page.locator('.board .card.selectable');
      if (guessed > 0 && !(await page.getByTestId('end-turn').isDisabled())) {
        await page.getByTestId('end-turn').click();
        guessed = 0;
        done++;
        continue;
      }
      const count = await tiles.count();
      if (!count) continue;
      await tiles.nth(Math.floor(Math.random() * count)).click();
      await page.getByTestId('reveal').click();
      guessed++;
      continue;
    }
    await page.waitForTimeout(150);
  }
  if (turns === Infinity) throw new Error('Game did not finish in time');
}
