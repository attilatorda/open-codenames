import { contextBridge, ipcRenderer } from 'electron';
import { CH, type ImageProgress, type OcApi } from '@shared/ipc';

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

/** The only bridge between the sandboxed UI and the main process. No key can be read back. */
const api: OcApi = {
  app: {
    info: () => invoke(CH.appInfo),
    setFullscreen: (on) => invoke(CH.appFullscreen, on),
    openExternal: (url) => invoke(CH.appOpenExternal, url),
    quit: () => invoke(CH.appQuit),
  },
  settings: {
    get: () => invoke(CH.settingsGet),
    update: (patch) => invoke(CH.settingsUpdate, patch),
    reset: () => invoke(CH.settingsReset),
  },
  credentials: {
    status: () => invoke(CH.credStatus),
    setLLMKey: (slot, key) => invoke(CH.credSetLLM, slot, key),
    setImageKey: (key) => invoke(CH.credSetImage, key),
    clearLLMKey: (slot) => invoke(CH.credClearLLM, slot),
    clearImageKey: () => invoke(CH.credClearImage),
    deleteAll: () => invoke(CH.credDeleteAll),
  },
  llm: {
    slots: () => invoke(CH.llmSlots),
    test: (slot) => invoke(CH.llmTest, slot),
    complete: (requestId, request) => invoke(CH.llmComplete, requestId, request),
    cancel: (requestId) => invoke(CH.llmCancel, requestId),
  },
  images: {
    url: (imageId) => `oc-img://i/${encodeURIComponent(imageId)}`,
    test: () => invoke(CH.imgTest),
    generate: (batchId, jobs) => invoke(CH.imgGenerate, batchId, jobs),
    cancel: (batchId) => invoke(CH.imgCancel, batchId),
    onProgress: (listener) => {
      const handler = (_e: unknown, p: ImageProgress) => listener(p);
      ipcRenderer.on(CH.imgProgress, handler);
      return () => ipcRenderer.removeListener(CH.imgProgress, handler);
    },
    library: () => invoke(CH.imgLibrary),
    pickFromLibrary: (count, seed) => invoke(CH.imgPick, count, seed),
    decks: () => invoke(CH.imgDecks),
    pickFromDeck: (count, seed, deckId) => invoke(CH.imgPickDeck, count, seed, deckId),
    chooseCollectionFolder: () => invoke(CH.imgChooseCollection),
    scanCollectionFolder: (folder) => invoke(CH.imgScanCollection, folder),
    importCollection: (request) => invoke(CH.imgImportCollection, request),
    removeCollection: (deckId) => invoke(CH.imgRemoveCollection, deckId),
    chooseFolder: () => invoke(CH.imgChooseFolder),
    rescanFolder: () => invoke(CH.imgRescan),
    clearGenerated: () => invoke(CH.imgClearGenerated),
  },
  replays: {
    save: (record) => invoke(CH.replaySave, record),
    list: () => invoke(CH.replayList),
    load: (id) => invoke(CH.replayLoad, id),
    remove: (id) => invoke(CH.replayRemove, id),
  },
  diagnostics: {
    list: () => invoke(CH.diagList),
    counters: () => invoke(CH.diagCounters),
    clear: () => invoke(CH.diagClear),
  },
};

contextBridge.exposeInMainWorld('oc', api);
