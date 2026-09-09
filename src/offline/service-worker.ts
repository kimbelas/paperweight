/// <reference lib="webworker" />

/**
 * The offline cache.
 *
 * Bundled to `out/sw.js` by `scripts/build-sw.mjs`, which fills in the
 * constants below from the actual build output. It is served from the origin
 * root because a service worker's default scope is the directory it is served
 * from, and this one has to cover the whole site.
 *
 * Everything the app loads is already same-origin — that is the privacy
 * promise and the Content-Security-Policy both — so caching adds no origin,
 * no request body and nothing that leaves the device. The policy needs no
 * change either: `worker-src 'self'` already covers this file, and every
 * fetch it makes is `connect-src 'self'`.
 *
 * # Three caches, not one
 *
 * The tempting design is a single cache named for the build. It is wrong here
 * for one reason: PDFium is 4.5 MB and it does not change when the app does.
 * A monolithic cache is invalidated by every deploy, because Next's build ID
 * is in the chunk names, so every user would re-download the engine to
 * receive a change to a button. So each cache is versioned by a stamp taken
 * from the bytes it is allowed to hold, and a deploy re-downloads only what
 * actually changed:
 *
 *  - the **shell** — the page, the interface, the manifest and the icons.
 *    Small, and stamped by content, so a rebuilt app replaces it.
 *  - the **engine** — the worker and the WASM binary. Stamped separately, so
 *    it survives an app deploy and is refetched only when PDFium moves.
 *  - the **runtime** cache, for everything else the app asks for. The fonts
 *    and the model that reads scans are 14 MB between them and each is needed
 *    only on the path that uses it, so they are kept the first time they are
 *    fetched rather than downloaded up front. `fonts.ts` says "never eagerly"
 *    about exactly those files.
 *
 * # Why the engine is warmed and not precached
 *
 * The engine has to be cached for "works offline" to mean anything: without
 * it the app opens and then cannot open a document, which is the half-shipped
 * offline mode this feature exists not to be. But fetching it during `install`
 * was a mistake with teeth. A browser allows about six connections to a host,
 * and an install that asks for 6 MB at once holds all of them — so the page's
 * own chunks queue behind the precache and the app takes seconds longer to
 * become usable, on exactly the first visit where it is being judged. It broke
 * an unrelated browser test outright, by starving the editor's dynamic import
 * until the test gave up waiting.
 *
 * So `install` caches the shell, which is small and is the thing that must be
 * complete, and the engine is fetched when the page says it has finished
 * loading — see `register.ts`. The download happens with nothing competing
 * for it, and until it lands the engine is cached the ordinary way, on first
 * use, by the fetch handler below.
 */

/** `paperweight-shell-<stamp>`; injected by the build. */
declare const __SHELL_CACHE__: string;
/** `paperweight-engine-<stamp>`; injected by the build. */
declare const __ENGINE_CACHE__: string;
/** `paperweight-runtime-<stamp>`; injected by the build. */
declare const __RUNTIME_CACHE__: string;
/** Root-relative URLs of the app shell, from the build output. */
declare const __SHELL_FILES__: string[];
/** Root-relative URLs of the engine, from the build output. */
declare const __ENGINE_FILES__: string[];

const sw = self as unknown as ServiceWorkerGlobalScope;

/** Every cache this build owns. Anything else under the prefix is a leftover. */
const MINE = new Set([__SHELL_CACHE__, __ENGINE_CACHE__, __RUNTIME_CACHE__]);

/** Namespace, so `activate` can never delete a cache belonging to something else. */
const PREFIX = 'paperweight-';

/**
 * The one page. Cached under `/` because that is what a navigation asks for;
 * `index.html` is the file behind it and never the request.
 */
const ENTRY = '/';

/** What `register.ts` sends once the page has finished loading. */
const WARM = 'paperweight-warm-engine';

/** The engine's URLs, for deciding which cache a response belongs in. */
const ENGINE = new Set(__ENGINE_FILES__);

sw.addEventListener('install', (event) => {
  event.waitUntil(install());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(activate());
});

sw.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type !== WARM) return;

  // `waitUntil` on the message, so the worker is kept alive for a download
  // that takes a while. Idempotent: `fill` skips what is already cached, so a
  // repeat visit costs three cache lookups.
  event.waitUntil(fill(__ENGINE_CACHE__, __ENGINE_FILES__, false));
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;

  // A cache holds GETs. Nothing here posts anywhere, but a service worker sees
  // every request and must not pretend otherwise.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin only. There is nothing cross-origin to fetch, and if a
  // dependency ever tries, the tests that assert zero off-site requests
  // should be what reports it — not a cache quietly making it work.
  if (url.origin !== sw.location.origin) return;

  // Source maps are devtools-only and `engine-worker.js.map` alone is 2 MB.
  if (url.pathname.endsWith('.map')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }

  event.respondWith(asset(event, url));
});

/**
 * Cache the shell.
 *
 * Required, all of it: a failure fails the install, the worker does not
 * activate, and the browser retries on the next navigation. That is the right
 * outcome, because a shell with a hole in it is a blank window offline — the
 * failure mode this whole feature is supposed to remove.
 */
async function install(): Promise<void> {
  await fill(__SHELL_CACHE__, __SHELL_FILES__, true);

  // Printed once, so which cache is serving a tab can be read off the console.
  // The engine's build stamp exists for the same reason: when behaviour and
  // source appear to disagree, the first question is what is actually running.
  console.info(`Paperweight offline cache ${__SHELL_CACHE__}`);

  // Take over without waiting for every tab to close. A stale worker serving
  // an old cache is the silent failure this project has been bitten by before
  // (see the engine worker's build stamp), and it is safe here: a navigation
  // is network-first, so a reload always re-anchors to the deployed build.
  await sw.skipWaiting();
}

/** Drop the caches of previous builds, then start serving the open tabs. */
async function activate(): Promise<void> {
  for (const name of await caches.keys()) {
    if (name.startsWith(PREFIX) && !MINE.has(name)) await caches.delete(name);
  }
  await sw.clients.claim();
}

/**
 * Cache a list of URLs, skipping what is already there.
 *
 * The skip is what makes the split into separate caches worth anything. A
 * cache is per-origin, not per-worker, so a cache whose name did not change
 * is the same cache after a deploy: the engine's 4.5 MB is still in it and is
 * left alone.
 *
 * Only the entry is refetched past the browser's own cache. It is the one URL
 * here whose contents change while its address does not, and the shell is
 * only coherent if the HTML matches the chunks stored beside it. Everything
 * else is either content-addressed by Next or an icon, where a copy from the
 * HTTP cache is both correct and already downloaded — asking for those again
 * would double the cost of the first visit for nothing.
 */
async function fill(name: string, urls: string[], required: boolean): Promise<void> {
  const cache = await caches.open(name);

  const writes = urls.map(async (url) => {
    if (await cache.match(url)) return;
    const response = await fetch(new Request(url, { cache: url === ENTRY ? 'reload' : 'default' }));
    if (!response.ok) throw new Error(`Could not cache ${url} (HTTP ${response.status}).`);
    await cache.put(url, response);
  });

  if (required) await Promise.all(writes);
  else await Promise.allSettled(writes);
}

/**
 * A page load: network first, cached shell second.
 *
 * Network first, so a deploy is picked up on the next reload rather than
 * whenever a cache happens to turn over — the app is a single page and the
 * whole of it is in that HTML.
 *
 * The cached copy is deliberately not refreshed from a successful response.
 * The shell is a matched set: HTML that names chunk files, and those files. A
 * newer page stored beside the old build's chunks would name files this cache
 * does not hold, and the next offline start would break — with everything
 * looking fresh. A new deploy changes this worker's stamps, so the way the
 * shell moves forward is a new install that rebuilds it whole.
 */
async function navigate(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    const shell = await caches.open(__SHELL_CACHE__);
    // Whatever path was asked for, the answer is the app: it is one page, and
    // its own router decides what to show.
    return (await shell.match(ENTRY)) ?? Response.error();
  }
}

/**
 * Anything else: cache first, then network, keeping what the network gave.
 *
 * Cache first is safe because every URL here is either content-addressed by
 * Next, a vendored binary pinned by a sync script, or covered by a stamp that
 * changes when its bytes do.
 *
 * `ignoreSearch` matters: the engine worker is requested as
 * `engine-worker.js?v=<build stamp>` and Next appends a hash to its metadata
 * files. Those queries exist to defeat the *browser's* cache, and this cache
 * is already keyed by the build, so matching on the path is correct — without
 * it, every deploy's new `?v=` would miss the precache it was just given.
 */
async function asset(event: FetchEvent, url: URL): Promise<Response> {
  const hit = await caches.match(event.request, { ignoreSearch: true });
  if (hit) return hit;

  const response = await fetch(event.request);

  // A 200 from this origin, and nothing else: a 206 is a fragment of a file
  // and an opaque response cannot be read back out of the cache. The set of
  // URLs that can land here is the site's own asset list — the fonts and the
  // OCR model are the point of it — so it is bounded and needs no eviction
  // policy of its own.
  if (response.status === 200 && response.type === 'basic') {
    // The engine goes in the engine cache however it was fetched. Otherwise a
    // document opened before the warm finished would leave 5 MB of PDFium in
    // the runtime cache as well, and the two would fall out of step on the
    // next PDFium upgrade.
    const name = ENGINE.has(url.pathname) ? __ENGINE_CACHE__ : __RUNTIME_CACHE__;
    const copy = response.clone();
    event.waitUntil(
      caches
        .open(name)
        .then((cache) => cache.put(event.request, copy))
        // A failed write is a slower app, not a broken one.
        .catch(() => {}),
    );
  }

  return response;
}
