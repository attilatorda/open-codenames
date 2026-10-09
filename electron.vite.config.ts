import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Strict CSP for the shipped game. Added at build time only, because Vite's dev server
// injects an inline React-refresh preamble that a strict policy would block.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' oc-img: data: blob:; font-src 'self' data:; connect-src 'self'";
const cspPlugin = {
  name: 'oc-csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) =>
    html.replace('<head>', `<head>
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
};

const alias = {
  '@core': resolve(__dirname, 'src/core'),
  '@shared': resolve(__dirname, 'src/shared'),
};

// OC_BUILD=release makes a release build; anything else (including plain `npm run dev`) is a debug build.
const define = { __OC_DEBUG__: JSON.stringify(process.env.OC_BUILD !== 'release') };

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    define,
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    define,
    build: {
      rollupOptions: {
        // Sandboxed preloads cannot `require` arbitrary modules, so emit CJS.
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        ...alias,
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react(), cspPlugin],
    define,
  },
});
