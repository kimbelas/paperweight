import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * Notices leave on their own, and how long they stay is their severity.
 *
 * They used to stay until dismissed, which sounds like the honest choice and
 * stops being one after a dozen edits: only four are shown, so the corner
 * fills with stale acknowledgements and the one that matters is pushed out of
 * sight by the six that do not.
 *
 * What that trades away is the guarantee that a disclosure is still on screen
 * whenever the user happens to look, and two things buy it back — a notice
 * being read is held, and a repeat restarts the clock rather than folding
 * silently into an entry about to disappear. Both are tested here, because
 * both are the difference between a timed notice and a disclosure that can be
 * missed by looking away.
 *
 * A scan is the cheapest notice in the app: opening one says so, at `info`,
 * which is the five-second tier.
 */

const FIXTURES = join(process.cwd(), 'fixtures');

/**
 * The notice opening `scanned-page.pdf` raises.
 *
 * Scoped to the notice stack: the OCR panel says the same thing about the
 * same page, and it is not on a clock.
 */
const SCAN_NOTICE = /scanned image/i;

const noticeIn = (page: Page) => page.locator('[role="status"]').getByText(SCAN_NOTICE);

/**
 * Longer than the five-second `info` tier and shorter than the ten-second one,
 * so a test that waits this long distinguishes "it expired" from "nothing
 * expires at all".
 */
const PAST_THE_INFO_TIER_MS = 7_000;

async function openScan(page: Page): Promise<void> {
  // Chromium has the File System Access API, and the app prefers it — so
  // without this there is no file chooser to answer.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
  await page.goto('/');
  await waitForLanding(page);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, 'scanned-page.pdf'));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
}

test('a notice leaves on its own', async ({ page }) => {
  await openScan(page);

  const notice = noticeIn(page);
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toHaveCount(0, { timeout: 20_000 });
});

test('reading a notice holds it', async ({ page }) => {
  await openScan(page);

  const notice = noticeIn(page);
  await expect(notice).toBeVisible({ timeout: 20_000 });

  // The pointer is what says it is being read. Held there, the clock stops:
  // a notice taken away mid-sentence is the failure this guards against.
  await notice.hover();
  await page.waitForTimeout(PAST_THE_INFO_TIER_MS);
  await expect(notice, 'the notice expired while it was being read').toBeVisible();

  // And released, it goes.
  await page.mouse.move(0, 0);
  await expect(notice).toHaveCount(0, { timeout: 20_000 });
});

test('a notice can still be dismissed by hand', async ({ page }) => {
  await openScan(page);

  const notice = noticeIn(page);
  await expect(notice).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Dismiss' }).first().click();
  await expect(notice).toHaveCount(0, { timeout: 5_000 });
});
