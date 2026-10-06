import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * Form fields on a phone, and the field kinds that once acted on the wrong
 * widget. Runs in all three engines; Firefox gets touch without `isMobile`,
 * which Playwright does not support there.
 */

const FIXTURES = join(process.cwd(), 'fixtures');

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: async ({ browserName }, use) => use(browserName !== 'firefox'),
});

async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await waitForLanding(page);
}

async function openFixture(page: Page, name: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, name));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });
}

/** A point in PDF space on a 612x792 page, in viewport pixels, scrolled into view. */
async function pdfPoint(page: Page, x: number, y: number, pageNumber = 1) {
  const canvas = page.locator(`canvas[aria-label="Page ${pageNumber}"]`);
  let box = (await canvas.boundingBox())!;
  const vy = box.y + (792 - y) * (box.height / 792);
  const vh = page.viewportSize()!.height;
  if (vy < 120 || vy > vh - 160) {
    await page.evaluate((d) => document.querySelector('main')?.scrollBy(0, d), vy - vh / 2);
    await page.waitForTimeout(250);
    box = (await canvas.boundingBox())!;
  }
  return { x: box.x + x * (box.width / 612), y: box.y + (792 - y) * (box.height / 792) };
}

async function tapPdf(page: Page, x: number, y: number): Promise<void> {
  const p = await pdfPoint(page, x, y);
  await page.touchscreen.tap(p.x, p.y);
}

const outline = (page: Page) => page.locator('[role="group"][aria-label^="Selected:"]');

test('tapping the second radio option selects it', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'form-kinds.pdf');

  // Select tool: first tap selects, second activates.
  await tapPdf(page, 267, 707);
  await expect(outline(page)).toBeVisible();
  await tapPdf(page, 267, 707);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });

  // The F box now carries the cross: more dark pixels than the M box.
  const ink = await page.evaluate(() => {
    const c = document.querySelector('canvas[aria-label="Page 1"]') as HTMLCanvasElement;
    const sx = c.width / 612;
    const count = (left: number) => {
      const d = c
        .getContext('2d')!
        .getImageData(
          Math.floor(left * sx),
          Math.floor((792 - 714) * sx),
          Math.ceil(14 * sx),
          Math.ceil(14 * sx),
        ).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 140) n++;
      return n;
    };
    return { m: count(200), f: count(260) };
  });
  expect(ink.f).toBeGreaterThan(ink.m);
});

test('undo clears a field selection', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  // Make an undo entry by ticking the Female box (select, then tap again).
  await tapPdf(page, 248, 544);
  await tapPdf(page, 248, 544);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });
  await tapPdf(page, 300, 665);
  await expect(outline(page)).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(outline(page)).toHaveCount(0);
});
