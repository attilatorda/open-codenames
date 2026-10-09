import { BrowserWindow, dialog, ipcMain, shell, app } from 'electron';
import type { LLMRequest, LLMResponse } from '@core/ai/LLMClient';
import type { GameRecord } from '@core/replay/GameRecord';
import {
  CH,
  type AppInfo,
  type ImageJob,
  type IpcResult,
  type LibraryStats,
  type SlotInfo,
  type TestResult,
} from '@shared/ipc';
import { describeSlot, imageProviderInfo, llmProviderInfo } from '@shared/providers';
import type { DeepPartial, Settings } from '@shared/settings';
import { generateBoardImages } from './images/boardImages';
import { importCollection, scanCollectionFolder } from './images/collectionImport';
import { DEFAULT_COLLECTION_ID, type ImportCollectionRequest } from '@shared/deck';
import type { ImageLibrary } from './images/ImageLibrary';
import type { ThumbnailCache } from './images/thumbnails';
import { ProviderError, toFriendly } from './providers/errors';
import { getImageProvider } from './providers/image/registry';
import { getLLMProvider, slotSeesImages } from './providers/llm/registry';
import type { ProviderContent, ProviderMessage } from './providers/llm/types';
import type { CredentialStore } from './store/CredentialStore';
import type { Diagnostics } from './store/diagnostics';
import type { ReplayStore } from './store/replayStore';
import type { SettingsStore } from './store/settingsStore';

export interface Services {
  settings: SettingsStore;
  credentials: CredentialStore;
  diagnostics: Diagnostics;
  library: ImageLibrary;
  thumbs: ThumbnailCache;
  replays: ReplayStore;
  devMock: boolean;
  /** Where imported picture collections are stored. */
  collectionsDir: string;
  window: () => BrowserWindow | null;
}

const ok = <T>(data: T): IpcResult<T> => ({ ok: true, data });
const fail = <T>(err: unknown): IpcResult<T> => ({ ok: false, error: toFriendly(err) });

export function registerIpc(svc: Services): void {
  const { settings, credentials, diagnostics, library, thumbs, replays } = svc;
  const pendingLLM = new Map<string, AbortController>();
  const pendingImages = new Map<string, AbortController>();

  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R) =>
    ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)));

  const providerAllowed = (id: string) => id !== 'mock' || svc.devMock;

  // ── App ──
  handle(CH.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    devMock: svc.devMock,
    userDataPath: app.getPath('userData'),
  }));
  handle(CH.appFullscreen, async (on: boolean) => {
    svc.window()?.setFullScreen(!!on);
    await settings.update({ display: { fullscreen: !!on } });
  });
  handle(CH.appOpenExternal, async (url: string) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) await shell.openExternal(url);
  });
  handle(CH.appQuit, () => app.quit());

  // ── Settings ──
  handle(CH.settingsGet, () => settings.get());
  handle(CH.settingsUpdate, (patch: DeepPartial<Settings>) => settings.update(patch));
  handle(CH.settingsReset, () => settings.reset());

  // ── Credentials (write-only from the renderer's point of view) ──
  handle(CH.credStatus, () => credentials.status());
  handle(CH.credSetLLM, async (slot: number, key: string) => {
    try {
      assertSlot(slot);
      if (typeof key !== 'string' || key.length > 500) throw new ProviderError('bad_request', 'That does not look like an API key.');
      await credentials.set(`llm:${slot}`, key);
      return ok(credentials.status());
    } catch (err) {
      return fail(err);
    }
  });
  handle(CH.credSetImage, async (key: string) => {
    try {
      if (typeof key !== 'string' || key.length > 500) throw new ProviderError('bad_request', 'That does not look like an API key.');
      await credentials.set('image', key);
      return ok(credentials.status());
    } catch (err) {
      return fail(err);
    }
  });
  handle(CH.credClearLLM, async (slot: number) => {
    assertSlot(slot);
    await credentials.clear(`llm:${slot}`);
    return credentials.status();
  });
  handle(CH.credClearImage, async () => {
    await credentials.clear('image');
    return credentials.status();
  });
  handle(CH.credDeleteAll, async () => {
    await credentials.deleteAll();
    diagnostics.log({ level: 'info', source: 'credentials', message: 'All saved API credentials were deleted.' });
    return credentials.status();
  });

  // ── LLM ──
  handle(CH.llmSlots, (): SlotInfo[] => {
    const s = settings.get();
    const status = credentials.status();
    return s.llmSlots.map((slot, i) => describeSlot(slot, i, status.llm[i].hasKey, providerAllowed));
  });

  handle(CH.llmTest, async (slotIndex: number): Promise<IpcResult<TestResult>> => {
    try {
      assertSlot(slotIndex);
      const { provider, ctx, slot, info } = resolveLLM(slotIndex);
      const models = await provider.listModels({ ...ctx, signal: AbortSignal.timeout(30_000) });
      let message = models.length ? `Connected — ${models.length} model${models.length === 1 ? '' : 's'} available.` : 'Connected.';
      if (models.length && ctx.model && !models.some((m) => m.id === ctx.model)) {
        message += ` Note: “${ctx.model}” was not in the list — pick a model from the dropdown.`;
      }
      if (!models.length && info.id === 'local') {
        await provider.complete({ ...ctx, signal: AbortSignal.timeout(120_000) }, { system: 'Reply with OK.', messages: [{ role: 'user', content: [{ type: 'text', text: 'OK?' }] }], maxTokens: 16 });
      }
      const discovered = models.slice(0, 400).map((m) => ({ id: m.id, label: m.label }));
      await updateSlot(slotIndex, { ...slot, lastTest: { ok: true, at: new Date().toISOString(), message }, discoveredModels: discovered });
      diagnostics.log({ level: 'info', source: 'llm', provider: info.id, slot: slotIndex, message: `Connection test OK: ${message}` });
      return ok({ message, models: discovered });
    } catch (err) {
      const f = toFriendly(err);
      diagnostics.log({ level: 'warn', source: 'llm', slot: slotIndex, message: `Connection test failed: ${f.message}`, detail: f.detail });
      const s = settings.get();
      if (s.llmSlots[slotIndex]) {
        await updateSlot(slotIndex, { ...s.llmSlots[slotIndex], lastTest: { ok: false, at: new Date().toISOString(), message: f.message } });
      }
      return { ok: false, error: f };
    }
  });

  handle(CH.llmComplete, async (requestId: string, req: LLMRequest): Promise<IpcResult<LLMResponse>> => {
    const controller = new AbortController();
    pendingLLM.set(requestId, controller);
    const started = Date.now();
    let providerId: string | undefined;
    try {
      assertSlot(req.slot);
      const { provider, ctx, slot } = resolveLLM(req.slot);
      providerId = provider.id;
      if (!slotSeesImages({ ...slot, model: ctx.model })) {
        throw new ProviderError('bad_request', 'This model cannot see pictures. Choose a vision model for this slot in AI configuration.');
      }
      const messages: ProviderMessage[] = [];
      for (const m of req.messages) {
        const content: ProviderContent[] = [];
        for (const p of m.content) {
          if (p.type === 'text') content.push({ type: 'text', text: p.text });
          else {
            const img = await thumbs.get(p.imageId);
            content.push(img ? { type: 'image', image: img, caption: library.get(p.imageId)?.caption } : { type: 'text', text: '(picture unavailable)' });
          }
        }
        messages.push({ role: m.role, content });
      }
      const res = await provider.complete(
        { ...ctx, signal: controller.signal },
        {
          system: req.system,
          messages,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          json: req.json,
          effort: req.effort,
          cacheImages: req.cacheImages,
        },
      );
      const latencyMs = Date.now() - started;
      const c = diagnostics.counters;
      c.llmCalls++;
      c.inputTokens += res.usage?.inputTokens ?? 0;
      c.outputTokens += res.usage?.outputTokens ?? 0;
      c.cachedInputTokens += res.usage?.cachedInputTokens ?? 0;
      diagnostics.log({
        level: 'info',
        source: 'llm',
        provider: provider.id,
        slot: req.slot,
        purpose: req.purpose,
        latencyMs,
        message: `${res.model}: ${res.usage?.inputTokens ?? '?'} in / ${res.usage?.outputTokens ?? '?'} out${res.usage?.cachedInputTokens ? ` (${res.usage.cachedInputTokens} cached)` : ''}`,
      });
      return ok({ ...res, latencyMs });
    } catch (err) {
      const f = toFriendly(err);
      if (f.kind !== 'aborted') {
        diagnostics.counters.llmErrors++;
        diagnostics.log({ level: 'error', source: 'llm', provider: providerId, slot: req.slot, purpose: req.purpose, message: f.message, detail: f.detail, latencyMs: Date.now() - started });
      }
      return { ok: false, error: f };
    } finally {
      pendingLLM.delete(requestId);
    }
  });

  handle(CH.llmCancel, (requestId: string) => {
    pendingLLM.get(requestId)?.abort();
  });

  // ── Images ──
  handle(CH.imgTest, async (): Promise<IpcResult<TestResult>> => {
    const s = settings.get();
    try {
      const { provider, ctx } = resolveImage();
      const message = await provider.test({ ...ctx, signal: AbortSignal.timeout(30_000) });
      await settings.update({ image: { lastTest: { ok: true, at: new Date().toISOString(), message } } });
      diagnostics.log({ level: 'info', source: 'image', provider: s.image.provider, message: `Connection test OK: ${message}` });
      return ok({ message });
    } catch (err) {
      const f = toFriendly(err);
      await settings.update({ image: { lastTest: { ok: false, at: new Date().toISOString(), message: f.message } } });
      diagnostics.log({ level: 'warn', source: 'image', provider: s.image.provider, message: `Connection test failed: ${f.message}`, detail: f.detail });
      return { ok: false, error: f };
    }
  });

  handle(CH.imgGenerate, async (batchId: string, jobs: ImageJob[]) => {
    const controller = new AbortController();
    pendingImages.set(batchId, controller);
    try {
      const { provider, ctx } = resolveImage();
      const s = settings.get();
      const results = await generateBoardImages({
        jobs,
        provider,
        ctx,
        library,
        diagnostics,
        reuseCache: s.image.reuseCache,
        mock: provider.id === 'mock',
        signal: controller.signal,
        concurrency: provider.local ? 1 : 3,
        onProgress: (p) => svc.window()?.webContents.send(CH.imgProgress, { ...p, batchId }),
      });
      return ok(results);
    } catch (err) {
      return fail(err);
    } finally {
      pendingImages.delete(batchId);
    }
  });

  handle(CH.imgCancel, (batchId: string) => {
    pendingImages.get(batchId)?.abort();
  });

  const stats = (): LibraryStats => library.stats(settings.get().image.folder, svc.devMock);
  handle(CH.imgLibrary, () => stats());
  handle(CH.imgPick, (count: number, seed: number) => {
    const picked = library.pick(count, seed, svc.devMock);
    if (picked.length < count) {
      const have = stats().total;
      return fail(new ProviderError('not_configured', `Your picture library has ${have} image${have === 1 ? '' : 's'}, but this board needs ${count}. Add pictures to your folder or choose a smaller board.`));
    }
    return ok(picked);
  });
  const standardDeckId = () => {
    const id = settings.get().image.deckId;
    return id && library.deckInfo(id) ? id : DEFAULT_COLLECTION_ID;
  };
  handle(CH.imgDecks, () => library.deckInfos());
  handle(CH.imgPickDeck, (count: number, seed: number, deckId?: string) => {
    const id = deckId && library.deckInfo(deckId) ? deckId : standardDeckId();
    const deck = library.deckInfo(id);
    const picked = library.pickDeck(id, count, seed);
    if (!deck || picked.length < count) {
      return fail(
        new ProviderError('not_configured', `The collection “${deck?.name ?? id}” has ${deck?.cards.length ?? 0} pictures, but this board needs ${count}. Pick a smaller board or another collection.`),
      );
    }
    return ok(picked);
  });
  handle(CH.imgChooseCollection, async () => {
    const win = svc.window();
    const opts = { title: 'Choose a folder of pictures for the new collection', properties: ['openDirectory' as const] };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || !result.filePaths[0]) return null;
    return scanCollectionFolder(result.filePaths[0]);
  });
  handle(CH.imgScanCollection, (folder: string) => scanCollectionFolder(folder));
  handle(CH.imgImportCollection, async (request: ImportCollectionRequest) => {
    try {
      const dir = await importCollection(request, svc.collectionsDir);
      const info = await library.loadDeck(dir, false);
      if (!info) throw new ProviderError('bad_request', 'The collection could not be read after importing.');
      diagnostics.log({ level: 'info', source: 'app', message: `Imported collection “${info.name}” (${info.cards.length} pictures)` });
      return ok(info);
    } catch (err) {
      return fail(err instanceof ProviderError ? err : new ProviderError('bad_request', (err as Error).message));
    }
  });
  handle(CH.imgRemoveCollection, async (deckId: string) => {
    const removed = await library.removeDeck(deckId);
    if (removed && settings.get().image.deckId === deckId) await settings.update({ image: { deckId: DEFAULT_COLLECTION_ID } });
    return removed;
  });
  handle(CH.imgChooseFolder, async () => {
    const win = svc.window();
    const result = win
      ? await dialog.showOpenDialog(win, { title: 'Choose a picture folder', properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ title: 'Choose a picture folder', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    await settings.update({ image: { folder: result.filePaths[0] } });
    await library.scanFolder(result.filePaths[0]);
    return stats();
  });
  handle(CH.imgRescan, async () => {
    await library.scanFolder(settings.get().image.folder);
    return stats();
  });
  handle(CH.imgClearGenerated, async () => {
    await library.clearGenerated();
    return stats();
  });

  // ── Replays ──
  handle(CH.replaySave, (record: GameRecord) => replays.save(record));
  handle(CH.replayList, () => replays.list());
  handle(CH.replayLoad, (id: string) => replays.load(id));
  handle(CH.replayRemove, (id: string) => replays.remove(id));

  // ── Diagnostics ──
  handle(CH.diagList, () => diagnostics.list());
  handle(CH.diagCounters, () => ({ ...diagnostics.counters }));
  handle(CH.diagClear, () => diagnostics.clear());

  // ── helpers ──
  function resolveLLM(slotIndex: number) {
    const s = settings.get();
    const slot = s.llmSlots[slotIndex];
    const info = llmProviderInfo(slot?.provider ?? '');
    if (!slot || !slot.enabled || !info || !providerAllowed(info.id)) {
      throw new ProviderError('not_configured', `LLM slot ${slotIndex + 1} is not set up. Open AI Configuration.`);
    }
    const provider = getLLMProvider(info.id);
    if (!provider) throw new ProviderError('not_configured', `Provider ${info.name} is not available.`);
    const apiKey = credentials.get(`llm:${slotIndex}`);
    if (info.keyRequired && !apiKey) {
      throw new ProviderError('not_configured', `LLM slot ${slotIndex + 1} (${info.name}) has no API key. Open AI Configuration.`);
    }
    const model = slot.model || info.defaultModel;
    return { provider, info, slot, ctx: { apiKey, model, baseUrl: slot.baseUrl || info.defaultBaseUrl } };
  }

  function resolveImage() {
    const s = settings.get();
    const info = imageProviderInfo(s.image.provider);
    if (!info || !providerAllowed(info.id)) {
      throw new ProviderError('not_configured', 'No image generator is set up. Open AI Configuration, or use your picture folder.');
    }
    const provider = getImageProvider(info.id)!;
    const apiKey = credentials.get('image');
    if (info.keyRequired && !apiKey) throw new ProviderError('not_configured', `The image generator (${info.name}) has no API key.`);
    return {
      provider,
      info,
      ctx: { apiKey, model: s.image.model || info.defaultModel, baseUrl: s.image.baseUrl || info.defaultBaseUrl, quality: s.image.quality },
    };
  }

  async function updateSlot(index: number, slot: Settings['llmSlots'][number]): Promise<void> {
    const slots = settings.get().llmSlots.slice();
    slots[index] = slot;
    await settings.update({ llmSlots: slots });
  }
}

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot > 3) throw new ProviderError('bad_request', 'Invalid LLM slot.');
}
