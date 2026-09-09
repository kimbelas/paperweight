/**
 * Register the offline cache.
 *
 * This lives in the client bundle rather than in an inline script on purpose.
 * `scripts/write-headers.mjs` allow-lists inline scripts in the
 * Content-Security-Policy by the SHA-256 of their exact contents, so every
 * inline script is a hash in that policy; a registration snippet in the HTML
 * would add one more for no reason. A module the bundler emits is covered by
 * `script-src 'self'` and needs nothing.
 *
 * There is no install prompt and no update toast. The browser offers the
 * install itself from `app/manifest.ts`, and a page that asks to be installed
 * before it has been used once is the behaviour this app is a reaction to.
 */

/** The worker, its scope, and how it is registered. */
const SCRIPT = '/sw.js';

/**
 * Asks the worker to cache the PDF engine.
 *
 * Sent once the page has finished loading, and this timing is the point of
 * the message. PDFium is 4.5 MB and caching it during `install` meant the
 * install held every connection the browser allows to a host, so the page's
 * own chunks queued behind it and the app took seconds longer to become
 * usable — on the first visit, which is the one that counts. Deferring it
 * costs nothing: until the engine lands, it is cached on first use like any
 * other asset.
 */
const WARM = { type: 'paperweight-warm-engine' };

/**
 * Start caching the app for offline use. Safe to call more than once: the
 * browser treats a repeat registration of the same script and scope as a
 * no-op with an update check.
 */
export function registerServiceWorker(): void {
  // Only the export has a worker. `scripts/build-sw.mjs` writes `out/sw.js`
  // as `postbuild`, because the precache list is a set of content-hashed chunk
  // names that only exist after a build — so under `next dev` there is no file
  // to register and asking for one would be a 404 on every reload.
  if (process.env.NODE_ENV !== 'production') return;

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  void navigator.serviceWorker
    .register(SCRIPT, {
      // The root, which is where the script is served from and what it has to
      // cover. Stated rather than inferred, so moving the file is a visible
      // decision instead of a silently narrowed scope.
      scope: '/',
      // Never take the worker itself from the HTTP cache. A cached service
      // worker is the failure this project has already paid for once with the
      // engine worker: the tab goes on running the previous one while the
      // source, the artefact and every test agree it should not.
      updateViaCache: 'none',
    })
    .catch((error: unknown) => {
      // Offline support is an enhancement, and everything about the app works
      // without it. A private window, a disabled worker or a browser that has
      // no service workers at all lands here, and none of them is a fault
      // worth putting in front of somebody editing a document.
      console.warn('Paperweight could not install the offline cache.', error);
    });

  whenLoaded(warmEngine);
}

/**
 * Run after the page has finished loading, or now if it already has.
 *
 * `load` rather than an effect, because an effect runs when React has
 * hydrated, which is well before the browser has stopped fetching. The
 * point of the deferral is an idle connection, not an idle component tree.
 */
function whenLoaded(run: () => void): void {
  if (document.readyState === 'complete') {
    run();
    return;
  }
  window.addEventListener('load', run, { once: true });
}

/**
 * `ready` resolves when a worker is active for this page, which is what makes
 * this safe on a first visit: the registration above may still be installing,
 * and posting to `controller` would find nothing there.
 */
function warmEngine(): void {
  void navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage(WARM))
    .catch(() => {
      // Nothing to do about it, and nothing lost: the engine is cached on
      // first use anyway. Silent, because this one is invisible to the user
      // either way.
    });
}
