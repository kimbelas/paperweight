import { expect, test } from '@playwright/test';
import { waitForLanding } from './helpers';

/**
 * The engine worker must be fetched with a URL that changes when it is
 * rebuilt.
 *
 * A worker is loaded by plain URL and browsers cache one hard. Without a
 * changing URL a rebuilt engine is silently ignored: the tab goes on running
 * the previous worker while every test passes against the new one. That is a
 * genuinely awful failure to diagnose, because the source is right, the built
 * artefact is right, and the app behaves as though neither had changed — it
 * looks exactly like a fix that does not work. It cost three rounds of
 * chasing the wrong thing on a real bug report.
 */

test('loads the engine worker with a cache-busting build stamp', async ({ page }) => {
  const workerRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('engine-worker.js')) workerRequests.push(request.url());
  });

  await page.goto('/');
  await waitForLanding(page);

  // The worker is created when the editor mounts.
  await expect.poll(() => workerRequests.length, { timeout: 20_000 }).toBeGreaterThan(0);

  const url = new URL(workerRequests[0]);
  const stamp = url.searchParams.get('v');

  expect(stamp, `worker requested as ${workerRequests[0]}`).toBeTruthy();
  // A millisecond timestamp, so plainly not a placeholder.
  expect(Number(stamp)).toBeGreaterThan(1_700_000_000_000);
});

/**
 * The stamp has to reach three places from one build: the worker's URL, the
 * binary's URL, and the offline service worker.
 *
 * The service worker answers engine requests from its cache while ignoring
 * the query, which is right for its own build and wrong for the first load
 * after a deploy, when the previous worker still answers and the page is
 * already new. It tells the two apart by the stamp, so the stamp it was built
 * with must be the one the page and the engine actually send. The binary is
 * stamped for the same reason: a new worker running the previous binary is a
 * glue-and-binary mismatch.
 */
test('the engine, its binary and the offline worker share one build stamp', async ({
  page,
  request,
}) => {
  // The worker request is page-initiated, so `page.on('request')` sees it. The
  // WASM request is not: the worker thread fetches it with `fetch`, which does
  // not surface here — so the binary's stamp is read from the worker's own
  // bytes, where `build-worker.mjs` baked it, rather than watched on the wire.
  const workerRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('engine-worker.js')) workerRequests.push(r.url());
  });
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));

  await page.goto('/');
  await waitForLanding(page);

  await expect.poll(() => workerRequests.length, { timeout: 20_000 }).toBeGreaterThan(0);
  const stamp = new URL(workerRequests[0]).searchParams.get('v');
  expect(stamp).toBeTruthy();

  // The worker builds the binary's URL with the same stamp.
  const worker = await request.get(`/engine-worker.js?v=${stamp}`);
  expect(worker.ok()).toBe(true);
  expect(await worker.text()).toContain(`pdfium.wasm?v=${stamp}`);

  // The offline worker is built knowing that stamp, so it can tell its own
  // engine apart from a newer page's.
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).toContain(`"${stamp}"`);

  // And the worker that answered says it is that build. The page's own line
  // only says what it asked for; this one is the engine speaking for itself,
  // and its absence would mean a cached engine — which the page then heals.
  await expect
    .poll(() => messages.some((m) => m.includes(`engine worker confirms build ${stamp}`)), {
      timeout: 30_000,
    })
    .toBe(true);
  expect(messages.filter((m) => /cached engine is running/.test(m))).toEqual([]);
});

test('reports which engine build is running', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));

  await page.goto('/');
  await waitForLanding(page);

  // Identifying the running engine from the console is what makes a stale
  // worker diagnosable instead of mysterious.
  await expect
    .poll(() => messages.filter((m) => /Paperweight engine build \d+/.test(m)).length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
});
