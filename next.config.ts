import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * Cache key for the engine worker.
 *
 * A worker is fetched by plain URL and browsers cache one hard, so a rebuilt
 * engine is otherwise ignored: the tab goes on running the previous worker
 * while the source and the built artefact are both correct. The stamp is the
 * one `build-worker.mjs` recorded in `engine-worker.meta.json` when it built
 * the worker, because that same value is baked into the worker (which puts
 * it on the WASM URL) and into the offline service worker (which refuses to
 * answer a request stamped with any other build from its cache). Three places
 * have to agree, so all three read one number. It is read here rather than
 * imported, because an import that only exists after a build breaks a fresh
 * clone and any stale bundler cache; the fallbacks keep such a clone running.
 */
function workerStamp(): string {
  try {
    const meta = JSON.parse(
      readFileSync(join(__dirname, 'public', 'engine-worker.meta.json'), 'utf8'),
    ) as { stamp?: number };
    if (meta.stamp) return String(meta.stamp);
  } catch {
    // Fall through to the worker file itself.
  }
  try {
    return String(Math.round(statSync(join(__dirname, 'public', 'engine-worker.js')).mtimeMs));
  } catch {
    // No worker built yet. A per-start value still beats a fixed URL.
    return String(Date.now());
  }
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_WORKER_STAMP: workerStamp() },

  // The whole app is static files. No server, no upload endpoint, nowhere for a
  // document to go. This is the privacy guarantee expressed as a build target,
  // and it also lets the same `out/` folder be hosted anywhere or wrapped in a
  // desktop shell unchanged.
  output: 'export',

  // Static export cannot set response headers, so COOP/COEP are unavailable and
  // SharedArrayBuffer with them. The engine is deliberately single-threaded.
  // See docs/research/03-viewer-print-save-packaging.md.
  reactStrictMode: true,
  images: { unoptimized: true },

  // Pin the workspace root. Without it the bundler walks up looking for a
  // lockfile, finds the one in the home directory, and warns that it would
  // treat the whole home directory as the project.
  turbopack: { root: __dirname },
};

export default nextConfig;
