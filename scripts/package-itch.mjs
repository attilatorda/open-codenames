// Collects the two release builds into release/itch/ for upload to itch.io:
//   OpenCodenames-<version>-windows.zip  (desktop, from `npm run dist:release`)
//   OpenCodenames-<version>-web.zip      (HTML5, from `npm run build:web`; index.html at the zip root)
// Usage: npm run dist:itch
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import yazl from 'yazl';

const root = process.cwd();
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const outDir = join(root, 'release', 'itch');
const desktopZip = join(root, 'release', 'desktop', `OpenCodenames-${version}-windows-x64.zip`);
const webDir = join(root, 'out', 'web');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// Desktop: the zip electron-builder made (exe, resources, docs, .itch.toml).
await stat(desktopZip).catch(() => {
  throw new Error(`Missing ${desktopZip} — run npm run dist:release first.`);
});
const desktopOut = join(outDir, `OpenCodenames-${version}-windows.zip`);
await copyFile(desktopZip, desktopOut);

// Web: zip the release web build so index.html sits at the root.
await stat(join(webDir, 'index.html')).catch(() => {
  throw new Error(`Missing ${webDir} — run npm run build:web first.`);
});
// A release build has no mock AI; its reply text would show up in a debug bundle.
for (const f of (await walk(webDir)).filter((f) => f.endsWith('.js'))) {
  if ((await readFile(f, 'utf8')).includes('unrecognized prompt')) throw new Error(`${f} contains the mock AI — build with npm run build:web.`);
}
const webOut = join(outDir, `OpenCodenames-${version}-web.zip`);
const zip = new yazl.ZipFile();
let files = 0;
for (const file of await walk(webDir)) {
  zip.addFile(file, relative(webDir, file).split(sep).join('/'));
  files++;
}
zip.end();
await new Promise((resolve, reject) => zip.outputStream.pipe(createWriteStream(webOut)).on('close', resolve).on('error', reject));

await writeFile(
  join(outDir, 'UPLOAD.txt'),
  [
    `Open Codenames ${version} — itch.io uploads`,
    '',
    `OpenCodenames-${version}-windows.zip`,
    '  Kind: Executable, platform Windows. Contains .itch.toml (the itch app launches "Open Codenames.exe").',
    '',
    `OpenCodenames-${version}-web.zip`,
    '  Kind: HTML, tick "This file will be played in the browser".',
    '  Embed: viewport 1280 × 800, leave "Mobile friendly" off, enable the fullscreen button.',
    '  Players bring their own API key (Anthropic, OpenAI, Google, OpenRouter, xAI or Mistral); keys stay in their browser.',
    '',
    'Page text: include the trademark notice —',
    '  “Codenames” is a registered trademark of Czech Games Edition. Open Codenames is an independent fan project',
    '  and is not affiliated with or endorsed by Czech Games Edition. Source code: MIT License.',
    '',
  ].join('\n'),
);

for (const f of [desktopOut, webOut]) console.log(`${relative(root, f)}  ${((await stat(f)).size / 1e6).toFixed(1)} MB`);
console.log(`web zip: ${files} files`);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out.sort();
}
