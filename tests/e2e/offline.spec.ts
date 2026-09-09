import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * The app with the network switched off.
 *
 * The FAQ now says Paperweight opens and edits documents with no network after
 * one online visit, and that claim is the only reason these tests exist. An
 * offline mode is uniquely easy to ship broken: the service worker registers,
 * the console says nothing, `caches` fills with something, and the failure is
 * only ever seen by somebody on a train — who cannot tell a bad cache from a
 * bad app. So the assertions here are the sentences in the FAQ, in order.
 *
 * `context.setOffline(true)` cuts the browser's network the way flight mode
 * does, leaving the service worker in place. That is the real shape of the
 * failure: the worker is the only thing standing between a reload and a
 * dinosaur.
 */
const FIXTURES = join(process.cwd(), 'fixtures');

/**
 * Wait until the worker is not merely registered but in control of this page.
 *
 * The distinction is the whole test. `register()` resolves as soon as the
 * browser has accepted the script, long before the precache is filled;
 * `controller` is only set once the worker has installed, activated and
 * claimed the client — which, because `install` awaits the precache, means
 * the shell and the engine are already in `caches`. Waiting on registration
 * instead would race the download and fail somewhere unhelpful.
 */
async function waitForController(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 60_000,
  });
}

test('the landing page still renders with the network off', async ({ page, context }) => {
  await page.goto('/');
  await waitForLanding(page);
  await waitForController(page);

  await context.setOffline(true);
  try {
    await page.reload();

    // `waitForLanding` is a stronger assertion than it looks. It waits for the
    // prerendered heading *and* for the button to be enabled, and only the
    // mounted editor enables it — so passing this offline means the HTML and
    // the whole client bundle came out of the cache, not just the page.
    await waitForLanding(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('a document still opens with the network off', async ({ page, context }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });

  await page.goto('/');
  await waitForLanding(page);
  await waitForController(page);

  // The premise, waited for rather than assumed. No document has been opened,
  // and PDFium is fetched on first use rather than on load, so the app has not
  // asked for the binary at all: the engine cache is the only thing that can
  // hold it.
  //
  // It is a poll because the engine is warmed after the page's `load` event
  // rather than during the install — 4.5 MB fetched while the app is still
  // starting held every connection the browser had. Waiting for the cache to
  // fill is therefore also the test of that warm message: nothing else sends
  // it, and without it this list stays empty.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          for (const name of await caches.keys()) {
            if (!name.startsWith('paperweight-engine-')) continue;
            const cache = await caches.open(name);
            return (await cache.keys()).map((request) => new URL(request.url).pathname).sort();
          }
          return null;
        }),
      { message: 'the engine never reached its cache', timeout: 60_000 },
    )
    .toEqual(['/engine-worker.js', '/pdfium/pdfium.wasm', '/pdfium/version.json']);

  await context.setOffline(true);
  try {
    await page.reload();
    await waitForLanding(page);

    // So if a page renders here, the engine and its WASM binary came out of
    // that cache: this is the test that the precache list is right, rather
    // than merely present.
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /choose a pdf/i }).click();
    await (await chooser).setFiles(join(FIXTURES, 'multipage.pdf'));

    await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });
  } finally {
    await context.setOffline(false);
  }
});

test('the worker is served as a script and is stamped', async ({ page, request }) => {
  const response = await request.get('/sw.js');
  expect(response.status(), '/sw.js is not being served').toBe(200);

  // The same lesson as the share image: a file the browser refuses on its
  // content type is a feature that silently does not exist, and nothing in
  // the build complains.
  expect(response.headers()['content-type']).toMatch(/javascript/);

  const source = await response.text();

  // Each cache carries a content stamp, because the cache name is the only
  // thing that decides whether an asset is refetched. Without one, a rebuilt
  // app is served from the old cache for as long as the browser feels like it
  // — the same silent staleness the engine worker's `?v=` exists to prevent.
  // Deduplicated, because each name is written wherever its cache is opened.
  const stamped = new Set(
    [...source.matchAll(/paperweight-(shell|engine|runtime)-[0-9a-f]{12}/g)].map(
      (match) => match[1]!,
    ),
  );
  expect([...stamped].sort(), 'the three stamped cache names').toEqual([
    'engine',
    'runtime',
    'shell',
  ]);

  // And the app registers it from the bundle rather than an inline script, so
  // the Content-Security-Policy's inline-script hashes do not change.
  await page.goto('/');
  const inlineRegistration = await page.evaluate(() =>
    [...document.querySelectorAll('script:not([src])')].some((script) =>
      script.textContent?.includes('serviceWorker'),
    ),
  );
  expect(inlineRegistration, 'registration is inline in the HTML').toBe(false);
});
