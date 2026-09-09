/**
 * Bundle the service worker into `out/sw.js`, with the precache lists and
 * cache stamps taken from the build that was just produced.
 *
 * This runs as `postbuild`, after `next build` and `write-headers`, and not
 * as `prebuild` into `public/`, for one reason: the app shell is a set of
 * content-hashed chunk names that do not exist until the build has run. A
 * worker written before the build could only guess at them, and a precache
 * list that guesses is a precache list that is quietly wrong — the install
 * fails on a 404, no worker activates, and the app has no offline mode while
 * appearing to have one. Reading the finished `out/` removes the guess.
 *
 * `out/sw.js` is at the origin root either way, which is what the worker needs
 * for its scope to cover the whole site.
 *
 * # The stamps
 *
 * A service worker is fetched by URL and compared byte for byte, so a cache
 * name is the only thing that decides whether an asset is refetched. Each
 * cache is stamped with a hash of the bytes it is allowed to hold:
 *
 *  - the shell moves with every build, because Next's build ID is in the
 *    chunk names, and it is small;
 *  - the engine moves only when the worker or the WASM binary does, which is
 *    the whole reason it is a separate cache. Otherwise a deploy would make
 *    every user download 4.5 MB of PDFium to receive a change to a label;
 *  - the runtime cache is stamped by the fonts and the OCR model, so an
 *    upgrade to either replaces them and nothing else does.
 *
 * Run with `node scripts/build-sw.mjs` (`pnpm build:sw`), after `next build`.
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'out');
const entry = join(root, 'src', 'offline', 'service-worker.ts');

/**
 * Files that record when a build ran rather than what it produced.
 *
 * A stamp must be derived from bytes that describe the asset, never from
 * provenance, or it moves on every build and the cache it names is discarded
 * on every deploy. `tesseract/assets.json` is the live example: `sync-ocr.mjs`
 * writes a `syncedAt` timestamp into it, so hashing it moved the runtime stamp
 * every time and would have thrown away the 8.5 MB OCR model with it — the
 * precise cost these separate stamps exist to avoid. Nothing fetches it.
 *
 * `_headers` and `sw.js` are here for the same reason: `_headers` holds this
 * build's inline-script hashes, and `sw.js` is the file being written, so
 * hashing the previous run would make the output depend on whether this script
 * had run before. Neither is ever fetched by a browser.
 */
const PROVENANCE = new Set(['/_headers', '/sw.js', '/tesseract/assets.json']);

/** Every file in `out/` worth caching, as a root-relative URL and a path. */
async function contents(dir = outDir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const item of entries) {
    const path = join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...(await contents(path)));
      continue;
    }
    const url = `/${relative(outDir, path).split(sep).join('/')}`;
    if (PROVENANCE.has(url) || url.endsWith('.map')) continue;
    files.push({ url, path });
  }
  return files;
}

/**
 * A short content hash over a set of files.
 *
 * The URL is hashed along with the bytes, so a file that moves invalidates the
 * cache as surely as a file that changes: the cache is keyed by URL, and a
 * renamed asset leaves a stale entry behind at the old name.
 */
async function stamp(files) {
  const digest = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.url.localeCompare(b.url))) {
    digest.update(file.url);
    digest.update(
      createHash('sha256')
        .update(await readFile(file.path))
        .digest(),
    );
  }
  return digest.digest('hex').slice(0, 12);
}

const files = await contents().catch(() => []);
if (files.length === 0) {
  throw new Error('No files in out/. Run `next build` first; this script runs as postbuild.');
}

const at = (url) => files.find((file) => file.url === url);
const under = (prefix) => files.filter((file) => file.url.startsWith(prefix));

const index = at('/index.html');
if (!index) throw new Error('out/index.html is missing, so there is no app shell to cache.');

/**
 * The shell: what has to be in place for the app to start with no network.
 *
 * `/index.html` is listed as `/`, because that is the URL a navigation asks
 * for and the cache is keyed by request. `404.html` is not here either, since
 * an offline navigation is answered with the app itself.
 *
 * The icons are listed at their root paths, which is where both the manifest
 * and the `<link rel="icon">` point — the latter as `/icon.svg?<hash>`, which
 * is why the worker matches with `ignoreSearch`. Next also copies them into
 * `_next/static/media/` and nothing references those copies, so the share
 * image is dropped: 57 KB of it, for the benefit of scrapers, which are
 * online by definition.
 */
const shell = [
  { url: '/', path: index.path },
  ...under('/_next/').filter((file) => !file.url.includes('/opengraph-image.')),
  ...['/manifest.webmanifest', '/icon.svg', '/apple-icon.png'].map(at).filter(Boolean),
  ...under('/icons/'),
];

/** The engine: PDFium and the worker that drives it. */
const engine = [...under('/pdfium/'), ...[at('/engine-worker.js')].filter(Boolean)];

for (const [name, list] of [
  ['shell', shell],
  ['engine', engine],
]) {
  if (list.length === 0) throw new Error(`Nothing matched the ${name} precache list.`);
}

/**
 * What the runtime cache is allowed to fill up with, for stamping only. These
 * are deliberately *not* precached: 14 MB fetched behind someone who came to
 * read the landing page would contradict the "never eagerly" in `fonts.ts`.
 */
const lazy = [...under('/fonts/'), ...under('/tesseract/')];

const [shellStamp, engineStamp, runtimeStamp] = await Promise.all([
  stamp(shell),
  stamp(engine),
  stamp(lazy),
]);

await build({
  entryPoints: [entry],
  outfile: join(outDir, 'sw.js'),
  bundle: true,
  // A classic script, not a module: module service workers are still
  // unsupported in Firefox, and esbuild has already resolved the imports.
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'none',
  // No source map. It would be another file in `out/` for a script nobody
  // debugs from a browser, and the source is in the repository.
  sourcemap: false,
  define: {
    __SHELL_CACHE__: JSON.stringify(`paperweight-shell-${shellStamp}`),
    __ENGINE_CACHE__: JSON.stringify(`paperweight-engine-${engineStamp}`),
    __RUNTIME_CACHE__: JSON.stringify(`paperweight-runtime-${runtimeStamp}`),
    __SHELL_FILES__: JSON.stringify(shell.map((file) => file.url)),
    __ENGINE_FILES__: JSON.stringify(engine.map((file) => file.url)),
  },
  tsconfig: join(root, 'tsconfig.json'),
  logLevel: 'warning',
});

const bytes = (await readFile(join(outDir, 'sw.js'))).length;

/**
 * The weight of a precache list, in kilobytes.
 *
 * Reported because it is a download every visitor pays for on their first
 * load, and a change to it should be visible in the build log rather than in
 * somebody's data allowance.
 */
async function weigh(list) {
  const sizes = await Promise.all(list.map(async (file) => (await readFile(file.path)).length));
  return (sizes.reduce((total, length) => total + length, 0) / 1024).toFixed(0);
}

console.log(
  `service worker → out/sw.js (${(bytes / 1024).toFixed(1)} KB): ` +
    `shell ${shellStamp}, ${shell.length} files, ${await weigh(shell)} KB · ` +
    `engine ${engineStamp}, ${engine.length} files, ${await weigh(engine)} KB · ` +
    `runtime ${runtimeStamp}, ${lazy.length} files on demand`,
);
