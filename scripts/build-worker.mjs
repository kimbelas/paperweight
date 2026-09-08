/**
 * Bundle the engine worker into `public/`.
 *
 * The obvious way to load a worker is
 * `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`,
 * and letting the app bundler handle it. That was tried first and it does not
 * survive this project's constraints: Turbopack treated the reference as a
 * static asset and copied `worker.ts` into the output verbatim, TypeScript
 * syntax and all, which a browser cannot execute. The failure is silent at
 * build time and only appears as a syntax error inside a worker at runtime.
 *
 * Bundling it here instead makes the worker an explicit build artefact:
 *
 *  - It is a real, self-contained ES module, so no bundler has to recognise
 *    any particular pattern for it to work.
 *  - It is loaded by plain URL, so it behaves the same under a static export,
 *    on any static host, and inside a desktop shell.
 *  - PDFium's bindings stay out of the main page bundle entirely.
 *
 * Run with `node scripts/build-worker.mjs [--watch]`.
 */
import { build, context } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const outfile = join(root, 'public', 'engine-worker.js');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [join(root, 'src', 'engine', 'worker.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  // Modern browsers only; the app already requires WebAssembly and workers.
  sourcemap: true,
  minify: process.env.NODE_ENV !== 'development',
  legalComments: 'none',
  // The WASM binary is fetched at runtime from /pdfium/, never imported, so
  // any stray reference to it from the vendor package must not be inlined.
  external: ['*.wasm'],
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
  // `@/` is used across the source tree and esbuild does not read tsconfig
  // paths unless pointed at it.
  tsconfig: join(root, 'tsconfig.json'),
  logLevel: 'warning',
};

const watch = process.argv.includes('--watch');

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('engine worker: watching for changes');
} else {
  await build(options);
  const bytes = await readFile(outfile);

  // Record what the worker was built from, so a stale artefact is diagnosable
  // rather than mysterious.
  const pkg = JSON.parse(
    await readFile(join(root, 'node_modules', '@embedpdf', 'pdfium', 'package.json'), 'utf8'),
  );
  const stamp = Date.now();

  await writeFile(
    join(root, 'public', 'engine-worker.meta.json'),
    JSON.stringify({ builtAt: new Date().toISOString(), pdfium: pkg.version, stamp }, null, 2) +
      '\n',
  );

  console.log(
    `engine worker → public/engine-worker.js (${(bytes.length / 1024).toFixed(1)} KB, pdfium ${pkg.version})`,
  );
}
