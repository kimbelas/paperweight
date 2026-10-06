import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * A document mixing portrait and landscape pages.
 *
 * Fitting the zoom to whichever page was current closed a loop with the
 * current-page calculation, and scrolling crashed the editor outright.
 */
test('scrolling through mixed page orientations does not crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
  await page.goto('/');
  await waitForLanding(page);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(process.cwd(), 'fixtures', 'mixed-orientation.pdf'));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });

  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => document.querySelector('main')?.scrollBy(0, 400));
    await page.waitForTimeout(150);
  }

  await expect(page.locator('canvas[aria-label="Page 4"]')).toBeVisible();
  expect(errors).toEqual([]);
});
