// The browser version of the `window.oc` bridge. On the desktop this API is served by the Electron
// main process; here everything runs in the page: settings, keys and game history live in this
// site's local storage, the standard deck is served as static files, and language-model calls go
// straight from the browser to the provider with the player's own key. Picture generation and
// personal picture folders are desktop-only.

import type { LLMRequest } from '@core/ai/LLMClient';
import type { GameRecord } from '@core/replay/GameRecord';
import { createRng } from '@core/util/rng';
import { DEBUG_BUILD } from '@shared/build';
import type { DeckInfo, DeckManifest } from '@shared/deck';
import { DEFAULT_COLLECTION_ID } from '@shared/deck';
import type {
  CredentialStatus,
  DiagnosticEntry,
  FriendlyError,
  IpcResult,
  LibraryImage,
  LibraryStats,
  OcApi,
  ReplaySummary,
  TestResult,
  UsageCounters,
} from '@shared/ipc';
import { describeSlot, llmProviderInfo, slotSeesImages, type LLMProviderId } from '@shared/providers';
import { LLM_SLOT_COUNT, defaultSettings, mergeSettings, type DeepPartial, type Settings } from '@shared/settings';
import { ProviderError, toFriendly } from '../main/providers/errors';
import { createLLMProviders } from '../main/providers/llm/registry';
import type { ProviderContent, ProviderMessage, ResolvedImage } from '../main/providers/llm/types';

declare const __OC_VERSION__: string;

const KEYS = {
  settings: 'oc.settings',
  credentials: 'oc.credentials',
  replays: 'oc.replays',
  replay: (id: string) => `oc.replay.${id}`,
};
const MAX_REPLAYS = 40;
const THUMB_SIDE = 384;
const KEY_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-(?:proj-|or-)?[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /xai-[A-Za-z0-9]{10,}/g,
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
];

// Built-in collections are bundled at build time; their pictures are copied next to index.html.
const MANIFESTS = import.meta.glob<DeckManifest>('../../resources/decks/*/deck.json', { eager: true, import: 'default' });

const ok = <T>(data: T): IpcResult<T> => ({ ok: true, data });
const fail = <T>(err: unknown): IpcResult<T> => ({ ok: false, error: toFriendly(err) });
const desktopOnly = (what: string): FriendlyError => ({ kind: 'not_configured', message: `${what} is available in the desktop version.` });

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (e.g. third-party storage disabled): the game still runs, it just forgets.
  }
}

export function createWebApi(): OcApi {
  const providers = createLLMProviders({ browser: true });
  const allowed = (id: LLMProviderId) => providers.has(id) && (id !== 'mock' || DEBUG_BUILD);

  // ── Settings ──
  /** The web build always deals from the standard deck. */
  const webOnly = (s: Settings): Settings => ({ ...s, image: { ...s.image, provider: 'none', model: '', source: 'deck' } });
  let settings = webOnly(mergeSettings(defaultSettings(), read<DeepPartial<Settings> | undefined>(KEYS.settings, undefined)));
  const saveSettings = (next: Settings) => {
    settings = webOnly(next);
    write(KEYS.settings, settings);
    return structuredClone(settings);
  };

  // ── Keys ──
  type Stored = { llm: (string | null)[]; image: string | null };
  const blank = (): Stored => ({ llm: Array.from({ length: LLM_SLOT_COUNT }, () => null), image: null });
  let keys: Stored = { ...blank(), ...read<Partial<Stored>>(KEYS.credentials, {}) };
  const saveKeys = () => write(KEYS.credentials, keys);
  const hint = (k: string | null) => (k ? { hasKey: true, hint: `…${k.slice(-4)}` } : { hasKey: false });
  const status = (): CredentialStatus => ({
    secureStorage: false,
    persistent: true,
    backend: 'browser',
    llm: Array.from({ length: LLM_SLOT_COUNT }, (_, i) => hint(keys.llm[i] ?? null)),
    image: hint(keys.image),
  });
  const checkKey = (key: string) => {
    if (typeof key !== 'string' || !key.trim() || key.length > 500) throw new ProviderError('bad_request', 'That does not look like an API key.');
  };

  // ── Diagnostics ──
  let entries: DiagnosticEntry[] = [];
  let nextId = 1;
  let counters: UsageCounters = emptyCounters();
  const redact = (text?: string) => {
    if (!text) return text;
    let out = text;
    for (const k of [...keys.llm, keys.image]) if (k) out = out.split(k).join('[redacted]');
    for (const p of KEY_PATTERNS) out = out.replace(p, '[redacted]');
    return out;
  };
  const log = (e: Omit<DiagnosticEntry, 'id' | 'at'>) => {
    entries.push({ ...e, id: nextId++, at: new Date().toISOString(), message: redact(e.message) ?? '', detail: redact(e.detail) });
    if (entries.length > 500) entries = entries.slice(-500);
  };

  // ── Decks ──
  const decks: DeckInfo[] = Object.values(MANIFESTS)
    .map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      builtIn: true,
      cards: m.cards.map((c) => ({ ...c, imageId: `decks/${m.id}/${c.file}` })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const captions = new Map(decks.flatMap((d) => d.cards.map((c) => [c.imageId, c.caption] as const)));
  const deckFor = (id?: string) =>
    decks.find((d) => d.id === id) ?? decks.find((d) => d.id === settings.image.deckId) ?? decks.find((d) => d.id === DEFAULT_COLLECTION_ID) ?? decks[0];

  // ── Pictures for vision models: small JPEGs, made once per picture ──
  const thumbs = new Map<string, Promise<ResolvedImage | null>>();
  const thumbnail = (imageId: string) => {
    if (!thumbs.has(imageId)) thumbs.set(imageId, makeThumbnail(imageId).catch(() => null));
    return thumbs.get(imageId)!;
  };

  // ── LLM ──
  const pending = new Map<string, AbortController>();
  const resolveLLM = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= LLM_SLOT_COUNT) throw new ProviderError('bad_request', 'Invalid LLM slot.');
    const slot = settings.llmSlots[index];
    const info = llmProviderInfo(slot?.provider ?? '');
    if (!slot || !slot.enabled || !info || !allowed(info.id)) {
      throw new ProviderError('not_configured', `LLM slot ${index + 1} is not set up. Open AI configuration.`);
    }
    const apiKey = keys.llm[index] ?? undefined;
    if (info.keyRequired && !apiKey) {
      throw new ProviderError('not_configured', `LLM slot ${index + 1} (${info.name}) has no API key. Open AI configuration.`);
    }
    return { provider: providers.get(info.id)!, info, slot, ctx: { apiKey, model: slot.model || info.defaultModel, baseUrl: slot.baseUrl || info.defaultBaseUrl } };
  };

  // ── Replays ──
  let replayIndex = read<ReplaySummary[]>(KEYS.replays, []);

  return {
    app: {
      info: async () => ({ version: __OC_VERSION__, platform: 'web', devMock: DEBUG_BUILD, userDataPath: '' }),
      setFullscreen: async (on) => {
        try {
          if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
          if (!on && document.fullscreenElement) await document.exitFullscreen();
        } catch {
          // Fullscreen can be refused (e.g. inside an embed without permission).
        }
        saveSettings(mergeSettings(settings, { display: { fullscreen: !!document.fullscreenElement } }));
      },
      openExternal: async (url) => {
        if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener');
      },
      quit: async () => undefined,
    },

    settings: {
      get: async () => structuredClone(settings),
      update: async (patch) => saveSettings(mergeSettings(settings, patch)),
      reset: async () => {
        const keep = { disclaimerAcceptedVersion: settings.disclaimerAcceptedVersion, setupComplete: settings.setupComplete, llmSlots: settings.llmSlots, image: settings.image };
        return saveSettings(mergeSettings(defaultSettings(), keep));
      },
    },

    credentials: {
      status: async () => status(),
      setLLMKey: async (slot, key) => {
        try {
          checkKey(key);
          keys.llm[slot] = key.trim();
          saveKeys();
          return ok(status());
        } catch (err) {
          return fail(err);
        }
      },
      setImageKey: async () => ({ ok: false, error: desktopOnly('Picture generation') }),
      clearLLMKey: async (slot) => {
        keys.llm[slot] = null;
        saveKeys();
        return status();
      },
      clearImageKey: async () => status(),
      deleteAll: async () => {
        keys = blank();
        saveKeys();
        log({ level: 'info', source: 'credentials', message: 'All saved API credentials were deleted.' });
        return status();
      },
    },

    llm: {
      slots: async () => settings.llmSlots.map((slot, i) => describeSlot(slot, i, !!keys.llm[i], allowed)),
      test: async (index): Promise<IpcResult<TestResult>> => {
        try {
          const { provider, ctx, slot, info } = resolveLLM(index);
          const models = await provider.listModels({ ...ctx, signal: AbortSignal.timeout(30_000) });
          let message = models.length ? `Connected — ${models.length} model${models.length === 1 ? '' : 's'} available.` : 'Connected.';
          if (models.length && ctx.model && !models.some((m) => m.id === ctx.model)) {
            message += ` Note: “${ctx.model}” was not in the list — pick a model from the dropdown.`;
          }
          const discovered = models.slice(0, 400).map((m) => ({ id: m.id, label: m.label }));
          updateSlot(index, { ...slot, lastTest: { ok: true, at: new Date().toISOString(), message }, discoveredModels: discovered });
          log({ level: 'info', source: 'llm', provider: info.id, slot: index, message: `Connection test OK: ${message}` });
          return ok({ message, models: discovered });
        } catch (err) {
          const f = toFriendly(err);
          log({ level: 'warn', source: 'llm', slot: index, message: `Connection test failed: ${f.message}`, detail: f.detail });
          const slot = settings.llmSlots[index];
          if (slot) updateSlot(index, { ...slot, lastTest: { ok: false, at: new Date().toISOString(), message: f.message } });
          return { ok: false, error: f };
        }
      },
      complete: async (requestId, req: LLMRequest) => {
        const controller = new AbortController();
        pending.set(requestId, controller);
        const started = Date.now();
        let providerId: string | undefined;
        try {
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
                const img = await thumbnail(p.imageId);
                content.push(img ? { type: 'image', image: img, caption: captions.get(p.imageId) } : { type: 'text', text: '(picture unavailable)' });
              }
            }
            messages.push({ role: m.role, content });
          }
          const res = await provider.complete(
            { ...ctx, signal: controller.signal },
            { system: req.system, messages, maxTokens: req.maxTokens, temperature: req.temperature, json: req.json, effort: req.effort, cacheImages: req.cacheImages },
          );
          const latencyMs = Date.now() - started;
          counters.llmCalls++;
          counters.inputTokens += res.usage?.inputTokens ?? 0;
          counters.outputTokens += res.usage?.outputTokens ?? 0;
          counters.cachedInputTokens += res.usage?.cachedInputTokens ?? 0;
          log({
            level: 'info',
            source: 'llm',
            provider: provider.id,
            slot: req.slot,
            purpose: req.purpose,
            latencyMs,
            message: `${res.model}: ${res.usage?.inputTokens ?? '?'} in / ${res.usage?.outputTokens ?? '?'} out`,
          });
          return ok({ ...res, latencyMs });
        } catch (err) {
          const f = toFriendly(err);
          if (f.kind !== 'aborted') {
            counters.llmErrors++;
            log({ level: 'error', source: 'llm', provider: providerId, slot: req.slot, purpose: req.purpose, message: f.message, detail: f.detail, latencyMs: Date.now() - started });
          }
          return { ok: false, error: f };
        } finally {
          pending.delete(requestId);
        }
      },
      cancel: async (requestId) => pending.get(requestId)?.abort(),
    },

    images: {
      url: (imageId) => imageId,
      test: async () => ({ ok: false, error: desktopOnly('Picture generation') }),
      generate: async () => ({ ok: false, error: desktopOnly('Picture generation') }),
      cancel: async () => undefined,
      onProgress: () => () => undefined,
      library: async () => emptyLibrary(),
      pickFromLibrary: async () => ({ ok: false, error: desktopOnly('Your own picture library') }),
      decks: async () => structuredClone(decks),
      pickFromDeck: async (count, seed, deckId) => {
        const deck = deckFor(deckId);
        if (!deck || deck.cards.length < count) {
          return fail(new ProviderError('not_configured', `The collection “${deck?.name ?? deckId}” has ${deck?.cards.length ?? 0} pictures, but this board needs ${count}.`));
        }
        const picked: LibraryImage[] = createRng(seed)
          .shuffle(deck.cards)
          .slice(0, count)
          .map((c) => ({ imageId: c.imageId, concept: c.caption ? c.caption.replace(/\.$/, '') : undefined, caption: c.caption || undefined, source: 'deck' }));
        return ok(picked);
      },
      chooseCollectionFolder: async () => null,
      scanCollectionFolder: async (folder) => ({ folder, images: 0, metadata: null, suggestedName: '' }),
      importCollection: async () => ({ ok: false, error: desktopOnly('Importing collections') }),
      removeCollection: async () => false,
      chooseFolder: async () => null,
      rescanFolder: async () => emptyLibrary(),
      clearGenerated: async () => emptyLibrary(),
    },

    replays: {
      save: async (record: GameRecord) => {
        if (!/^[\w-]+$/.test(record.id)) return;
        const summary: ReplaySummary = {
          id: record.id,
          modeId: record.modeId,
          createdAt: record.createdAt,
          winner: record.winner,
          winReason: record.winReason,
          aborted: record.aborted,
          humanTeam: record.humanTeam,
          players: record.players.map((p) => ({ name: p.name, team: p.team, role: p.role, kind: p.kind, model: p.model })),
        };
        replayIndex = [summary, ...replayIndex.filter((r) => r.id !== record.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        for (const old of replayIndex.slice(MAX_REPLAYS)) localStorage.removeItem(KEYS.replay(old.id));
        replayIndex = replayIndex.slice(0, MAX_REPLAYS);
        write(KEYS.replay(record.id), record);
        write(KEYS.replays, replayIndex);
      },
      list: async () => structuredClone(replayIndex),
      load: async (id) => read<GameRecord | null>(KEYS.replay(id), null),
      remove: async (id) => {
        replayIndex = replayIndex.filter((r) => r.id !== id);
        localStorage.removeItem(KEYS.replay(id));
        write(KEYS.replays, replayIndex);
      },
    },

    diagnostics: {
      list: async () => entries.slice().reverse(),
      counters: async () => ({ ...counters }),
      clear: async () => {
        entries = [];
        counters = emptyCounters();
      },
    },
  };

  function updateSlot(index: number, slot: Settings['llmSlots'][number]): void {
    const slots = settings.llmSlots.slice();
    slots[index] = slot;
    saveSettings(mergeSettings(settings, { llmSlots: slots }));
  }
}

async function makeThumbnail(imageId: string): Promise<ResolvedImage | null> {
  const res = await fetch(imageId);
  if (!res.ok) return null;
  const bitmap = await createImageBitmap(await res.blob());
  const scale = Math.min(1, THUMB_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return { mimeType: 'image/jpeg', base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

function emptyLibrary(): LibraryStats {
  return { total: 0, generated: 0, folder: 0 };
}

function emptyCounters(): UsageCounters {
  return { llmCalls: 0, llmErrors: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, imagesGenerated: 0, imagesFromCache: 0, imageErrors: 0 };
}
