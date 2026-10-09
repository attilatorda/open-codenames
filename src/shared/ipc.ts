// The typed contract between the renderer (UI + game) and the main process (keys, providers, disk).
// API keys only ever travel renderer → main when the player types them; they are never sent back.

import type { LLMRequest, LLMResponse } from '@core/ai/LLMClient';
import type { GameRecord } from '@core/replay/GameRecord';
import type { DeepPartial, Settings } from './settings';
import type { DeckInfo, FolderScan, ImportCollectionRequest } from './deck';

export type ErrorKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'moderation'
  | 'not_found'
  | 'bad_request'
  | 'bad_response'
  | 'server'
  | 'not_configured'
  | 'aborted'
  | 'unknown';

export interface FriendlyError {
  kind: ErrorKind;
  /** Safe for the main UI. */
  message: string;
  /** Technical detail for the diagnostics panel. */
  detail?: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: FriendlyError };

export interface KeyStatus {
  hasKey: boolean;
  /** Last characters of the key, e.g. "…a1b2". */
  hint?: string;
}

export interface CredentialStatus {
  /** OS-backed encryption available (DPAPI / Keychain / libsecret). */
  secureStorage: boolean;
  /** When false, keys are kept in memory for this session only. */
  persistent: boolean;
  backend: string;
  llm: KeyStatus[];
  image: KeyStatus;
}

export interface TestResult {
  message: string;
  models?: { id: string; label: string }[];
}

export interface SlotInfo {
  slot: number;
  ready: boolean;
  provider: string;
  providerName: string;
  model: string;
  modelLabel: string;
  vision: boolean;
}

export interface ImageJob {
  cardId: number;
  concept: string;
  prompt: string;
  styleId: string;
}

export interface ImageJobResult {
  cardId: number;
  imageId: string;
  concept: string;
  cached: boolean;
}

export interface ImageProgress {
  batchId: string;
  cardId: number;
  status: 'done' | 'retrying' | 'failed' | 'swapped';
  imageId?: string;
  done: number;
  total: number;
  message?: string;
}

export interface LibraryImage {
  imageId: string;
  concept?: string;
  caption?: string;
  source: 'generated' | 'folder' | 'mock' | 'deck';
}

export interface LibraryStats {
  total: number;
  generated: number;
  folder: number;
  folderPath?: string;
}

export interface ReplaySummary {
  id: string;
  modeId: string;
  createdAt: string;
  winner?: string;
  winReason?: string;
  aborted?: boolean;
  humanTeam?: string;
  players: { name: string; team: string; role: string; kind: string; model?: string }[];
}

export interface DiagnosticEntry {
  id: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  source: 'llm' | 'image' | 'app' | 'credentials';
  message: string;
  detail?: string;
  provider?: string;
  slot?: number;
  purpose?: string;
  latencyMs?: number;
}

export interface UsageCounters {
  llmCalls: number;
  llmErrors: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  imagesGenerated: number;
  imagesFromCache: number;
  imageErrors: number;
}

export interface AppInfo {
  version: string;
  platform: string;
  /** Debug build: the offline mock AI and placeholder image generator are available. */
  devMock: boolean;
  userDataPath: string;
}

export interface OcApi {
  app: {
    info(): Promise<AppInfo>;
    setFullscreen(on: boolean): Promise<void>;
    openExternal(url: string): Promise<void>;
    quit(): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: DeepPartial<Settings>): Promise<Settings>;
    reset(): Promise<Settings>;
  };
  credentials: {
    status(): Promise<CredentialStatus>;
    setLLMKey(slot: number, key: string): Promise<IpcResult<CredentialStatus>>;
    setImageKey(key: string): Promise<IpcResult<CredentialStatus>>;
    clearLLMKey(slot: number): Promise<CredentialStatus>;
    clearImageKey(): Promise<CredentialStatus>;
    deleteAll(): Promise<CredentialStatus>;
  };
  llm: {
    slots(): Promise<SlotInfo[]>;
    test(slot: number): Promise<IpcResult<TestResult>>;
    complete(requestId: string, request: LLMRequest): Promise<IpcResult<LLMResponse>>;
    cancel(requestId: string): Promise<void>;
  };
  images: {
    /** URL the UI can load a picture from. */
    url(imageId: string): string;
    test(): Promise<IpcResult<TestResult>>;
    generate(batchId: string, jobs: ImageJob[]): Promise<IpcResult<ImageJobResult[]>>;
    cancel(batchId: string): Promise<void>;
    onProgress(listener: (p: ImageProgress) => void): () => void;
    library(): Promise<LibraryStats>;
    pickFromLibrary(count: number, seed: number): Promise<IpcResult<LibraryImage[]>>;
    /** Every picture collection (built-in and imported) with artwork credits. */
    decks(): Promise<DeckInfo[]>;
    /** Deal from a collection; defaults to the standard collection in settings. */
    pickFromDeck(count: number, seed: number, deckId?: string): Promise<IpcResult<LibraryImage[]>>;
    chooseCollectionFolder(): Promise<FolderScan | null>;
    scanCollectionFolder(folder: string): Promise<FolderScan>;
    importCollection(request: ImportCollectionRequest): Promise<IpcResult<DeckInfo>>;
    removeCollection(deckId: string): Promise<boolean>;
    chooseFolder(): Promise<LibraryStats | null>;
    rescanFolder(): Promise<LibraryStats>;
    clearGenerated(): Promise<LibraryStats>;
  };
  replays: {
    save(record: GameRecord): Promise<void>;
    list(): Promise<ReplaySummary[]>;
    load(id: string): Promise<GameRecord | null>;
    remove(id: string): Promise<void>;
  };
  diagnostics: {
    list(): Promise<DiagnosticEntry[]>;
    counters(): Promise<UsageCounters>;
    clear(): Promise<void>;
  };
}

/** Channel names, shared by preload and main so they cannot drift. */
export const CH = {
  appInfo: 'oc:app:info',
  appFullscreen: 'oc:app:fullscreen',
  appOpenExternal: 'oc:app:openExternal',
  appQuit: 'oc:app:quit',
  settingsGet: 'oc:settings:get',
  settingsUpdate: 'oc:settings:update',
  settingsReset: 'oc:settings:reset',
  credStatus: 'oc:cred:status',
  credSetLLM: 'oc:cred:setLLM',
  credSetImage: 'oc:cred:setImage',
  credClearLLM: 'oc:cred:clearLLM',
  credClearImage: 'oc:cred:clearImage',
  credDeleteAll: 'oc:cred:deleteAll',
  llmSlots: 'oc:llm:slots',
  llmTest: 'oc:llm:test',
  llmComplete: 'oc:llm:complete',
  llmCancel: 'oc:llm:cancel',
  imgTest: 'oc:img:test',
  imgGenerate: 'oc:img:generate',
  imgCancel: 'oc:img:cancel',
  imgProgress: 'oc:img:progress',
  imgLibrary: 'oc:img:library',
  imgPick: 'oc:img:pick',
  imgDecks: 'oc:img:decks',
  imgPickDeck: 'oc:img:pickDeck',
  imgChooseCollection: 'oc:img:chooseCollection',
  imgScanCollection: 'oc:img:scanCollection',
  imgImportCollection: 'oc:img:importCollection',
  imgRemoveCollection: 'oc:img:removeCollection',
  imgChooseFolder: 'oc:img:chooseFolder',
  imgRescan: 'oc:img:rescan',
  imgClearGenerated: 'oc:img:clearGenerated',
  replaySave: 'oc:replay:save',
  replayList: 'oc:replay:list',
  replayLoad: 'oc:replay:load',
  replayRemove: 'oc:replay:remove',
  diagList: 'oc:diag:list',
  diagCounters: 'oc:diag:counters',
  diagClear: 'oc:diag:clear',
} as const;
