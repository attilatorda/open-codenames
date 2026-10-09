import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, Menu, app, net, protocol, safeStorage, shell } from 'electron';
import { registerIpc } from './ipc';
import { ImageLibrary } from './images/ImageLibrary';
import { ThumbnailCache } from './images/thumbnails';
import { CredentialStore } from './store/CredentialStore';
import { Diagnostics } from './store/diagnostics';
import { ReplayStore } from './store/replayStore';
import { SettingsStore } from './store/settingsStore';
import { DEBUG_BUILD } from '@shared/build';

const IMAGE_SCHEME = 'oc-img';
const TITLE = DEBUG_BUILD ? 'Open Codenames (Debug)' : 'Open Codenames';

// Allow a separate profile for automated tests (keeps the player's real data untouched).
// Debug builds keep their own profile, so the mock AI never leaks into a release install.
if (process.env.OC_USER_DATA) app.setPath('userData', process.env.OC_USER_DATA);
else if (DEBUG_BUILD) app.setPath('userData', join(app.getPath('appData'), 'Open Codenames Debug'));

protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(start);
}

async function start(): Promise<void> {
  const userData = app.getPath('userData');
  const settings = new SettingsStore(userData);
  const credentials = new CredentialStore(userData, safeStorage);
  const diagnostics = new Diagnostics(userData);
  const library = new ImageLibrary(userData);
  const replays = new ReplayStore(userData);
  await Promise.all([settings.load(), credentials.load(), library.load()]);
  // Built-in collections ship next to the app (extraResources); imported ones live in userData.
  const builtInDecks = app.isPackaged ? join(process.resourcesPath, 'decks') : join(app.getAppPath(), 'resources', 'decks');
  const collectionsDir = join(userData, 'collections');
  await library.loadDecks(builtInDecks, true);
  await library.loadDecks(collectionsDir, false);
  const deckCount = library.deckInfos().length;
  diagnostics.setSecretSource(() => credentials.allSecrets());
  const thumbs = new ThumbnailCache(library);
  void library.scanFolder(settings.get().image.folder);

  // Serve local pictures to the UI without exposing the file system.
  protocol.handle(IMAGE_SCHEME, async (request) => {
    const id = new URL(request.url).pathname.replace(/^\//, '');
    const entry = /^[fgd][0-9a-f]{31}$/.test(id) ? library.get(id) : undefined;
    if (!entry) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(entry.file).toString());
    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': entry.mime, 'Cache-Control': 'max-age=31536000, immutable' },
    });
  });

  registerIpc({ settings, credentials, diagnostics, library, thumbs, replays, devMock: DEBUG_BUILD, collectionsDir, window: () => mainWindow });


  Menu.setApplicationMenu(null);
  createWindow(settings.get().display.fullscreen);
  diagnostics.log({
    level: 'info',
    source: 'app',
    message: `Open Codenames ${app.getVersion()} started (${process.platform}, secure key storage: ${credentials.secure ? credentials.backend : 'unavailable'}, picture collections: ${deckCount})`,
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings.get().display.fullscreen);
  });
}

function createWindow(fullscreen: boolean): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    fullscreen,
    backgroundColor: '#e6dfd2',
    title: TITLE,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // No pop-ups; https links open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    event.preventDefault();
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
    if (input.key === 'F12' && (!app.isPackaged || DEBUG_BUILD)) mainWindow?.webContents.toggleDevTools();
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
