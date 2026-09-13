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
 * Marks that a reload has already been spent trying to shed a stale engine for
 * a given build, so `recoverFromStaleEngine` can never loop.
 */
const RECOVERY_MARK = 'paperweight-engine-recovery';

/**
 * Recover when the running engine is not the one this page was built for.
 *
 * The engine worker and the WASM binary are served by the offline worker,
 * cache-first. The stamp on their URL and the guard in `service-worker.ts`
 * make a *newer* offline worker refuse to answer with an older engine — but
 * the offline worker that ships that guard is itself deployed as the engine
 * is fixed, and the previous one, already installed in a returning visitor's
 * browser, has no such guard. So the first load after that particular deploy
 * is served the previous engine by the previous worker, and no change to the
 * new worker can reach back and stop it. The page is the only place left that
 * can tell, because only the worker reports which build actually answered.
 *
 * The cure is the standard one, driven from the page: ask the registration to
 * update (which installs the new, guarded worker and, via `skipWaiting`, hands
 * it control), then reload so the new worker serves the fetch. A `controller`
 * has to exist for this to be the explanation at all; without one, a reload
 * changes nothing and is not attempted. One reload per build, remembered
 * across it in `sessionStorage`, because a mismatch that survives the reload
 * is something a reload cannot fix and must not be retried into a loop.
 */
export async function recoverFromStaleEngine(expected: string): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // No worker in control means the cache is not the cause, so a reload is
  // pointless. The browser's own `?v=` already defeats its HTTP cache.
  if (!navigator.serviceWorker.controller) return;

  let alreadyTried: string | null = null;
  try {
    alreadyTried = sessionStorage.getItem(RECOVERY_MARK);
  } catch {
    // Private windows can throw. Without a durable mark a reload could loop,
    // so treat storage being unavailable as "already tried" and only warn.
    alreadyTried = expected;
  }
  if (alreadyTried === expected) {
    console.error(
      `Paperweight is still running engine build other than ${expected} after a reload. ` +
        `Close every tab of the site and reopen it; if it persists you may be offline.`,
    );
    return;
  }
  try {
    sessionStorage.setItem(RECOVERY_MARK, expected);
  } catch {
    // Nothing to persist the guard in; do not risk a reload loop.
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.update().catch(() => {});
      await new Promise<void>((resolve) => {
        const done = setTimeout(resolve, 6000);
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            clearTimeout(done);
            resolve();
          },
          { once: true },
        );
      });
    }
  } catch {
    // Fall through to the reload regardless: it is the guarded, one-time step.
  }
  window.location.reload();
}

/**
 * The running engine is the one expected, so clear any recovery mark: a stale
 * engine detected later, after another deploy, should get its own reload.
 */
export function confirmEngineFresh(): void {
  try {
    sessionStorage.removeItem(RECOVERY_MARK);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

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
