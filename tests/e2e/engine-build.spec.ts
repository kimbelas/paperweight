import { expect, test } from '@playwright/test';

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
  await expect(page.getByRole('heading', { name: /open a pdf to edit/i })).toBeVisible();

  // The worker is created when the editor mounts.
  await expect.poll(() => workerRequests.length, { timeout: 20_000 }).toBeGreaterThan(0);

  const url = new URL(workerRequests[0]);
  const stamp = url.searchParams.get('v');

  expect(stamp, `worker requested as ${workerRequests[0]}`).toBeTruthy();
  // A millisecond timestamp, so plainly not a placeholder.
  expect(Number(stamp)).toBeGreaterThan(1_700_000_000_000);
});

test('reports which engine build is running', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /open a pdf to edit/i })).toBeVisible();

  // Identifying the running engine from the console is what makes a stale
  // worker diagnosable instead of mysterious.
  await expect
    .poll(() => messages.filter((m) => /Paperweight engine build \d+/.test(m)).length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
});
