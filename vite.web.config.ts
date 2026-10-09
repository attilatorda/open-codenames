// Browser build of the game (for itch.io HTML5): `npm run build:web`. The UI is the desktop renderer;
// src/web replaces the Electron main process with an in-page bridge, and the standard deck ships as
// static files next to index.html.
import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
const debug = process.env.OC_BUILD !== 'release';
const outDir = resolve(__dirname, debug ? 'out/web-debug' : 'out/web');

// API hosts the browser build may talk to (all allow cross-origin requests from the page).
const CONNECT = [
  'https://api.anthropic.com',
  'https://api.openai.com',
  'https://generativelanguage.googleapis.com',
  'https://openrouter.ai',
  'https://api.x.ai',
  'https://api.mistral.ai',
].join(' ');
const CSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${CONNECT}`;

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  base: './',
  // resources/decks/<id>/… is served as decks/<id>/… (the deck.json files are also bundled).
  publicDir: resolve(__dirname, 'resources'),
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  define: {
    __OC_DEBUG__: JSON.stringify(debug),
    __OC_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    {
      // The license and third-party notices (including the font license) ship with the build.
      name: 'oc-web-notices',
      apply: 'build',
      closeBundle() {
        copyFileSync(resolve(__dirname, 'LICENSE'), resolve(outDir, 'LICENSE.txt'));
        copyFileSync(resolve(__dirname, 'THIRD_PARTY_NOTICES.md'), resolve(outDir, 'THIRD_PARTY_NOTICES.md'));
      },
    },
    {
      name: 'oc-web-csp',
      apply: 'build',
      transformIndexHtml: (html: string) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
  },
});
