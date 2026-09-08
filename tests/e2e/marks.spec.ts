import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

/**
 * Marks: putting a cross or a tick on a page.
 *
 * The case this exists for is the checkbox that is printed on the page rather
 * than being an interactive field, which is most of them once a form has been
 * laid out by anything but a form builder. There is nothing to tick, so
 * something has to be drawn.
 *
 * The round trip at the end is the test that matters. A mark that appears on
 * the canvas and is missing from the saved file would be the worst shape of
 * failure here — the user sees a filled-in form on screen and sends a blank
 * one — and it is exactly what happens if a pending overlay is not flattened
 * before the bytes are produced.
 */

const FIXTURES = join(process.cwd(), 'fixtures');

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /open a pdf to edit/i })).toBeVisible();
  return errors;
}

async function openFixture(page: Page, fixture: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, fixture));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(1200);
}

/** Click a point given in PDF coordinates on a 612x792 page. */
async function clickPdf(page: Page, pdfX: number, pdfY: number, button?: 'right'): Promise<void> {
  const box = (await page.locator('canvas[aria-label="Page 1"]').boundingBox())!;
  await page.mouse.click(
    box.x + pdfX * (box.width / 612),
    box.y + (792 - pdfY) * (box.height / 792),
    button ? { button } : undefined,
  );
}

/** Dark pixels inside a PDF-space rectangle of the rendered page. */
async function inkIn(
  page: Page,
  rect: { left: number; bottom: number; right: number; top: number },
): Promise<number> {
  return page.evaluate((r) => {
    const canvas = document.querySelector('canvas[aria-label="Page 1"]') as HTMLCanvasElement;
    const sx = canvas.width / 612;
    const sy = canvas.height / 792;
    const { data } = canvas
      .getContext('2d')!
      .getImageData(
        Math.floor(r.left * sx),
        Math.floor((792 - r.top) * sy),
        Math.ceil((r.right - r.left) * sx),
        Math.ceil((r.top - r.bottom) * sy),
      );
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 140) dark++;
    return dark;
  }, rect);
}

/** A blank patch of the form, well clear of anything printed. */
const BLANK = { left: 480, bottom: 420, right: 520, top: 460 };

test('the Mark tool offers a palette and places what is picked', async ({ page }) => {
  const errors = await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  await page.getByRole('button', { name: 'Mark' }).click();

  // The palette only appears with the tool armed, and the swatches are the
  // marks themselves.
  const palette = page.getByRole('group', { name: 'Which mark' });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('button', { name: 'Cross' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await palette.getByRole('button', { name: 'Tick' }).click();
  await clickPdf(page, 500, 440);

  // Placed but not yet in the file, and the status bar says so.
  await expect(page.getByText(/1 item not yet written to the file/i)).toBeVisible();
  expect(errors).toEqual([]);
});

test('right-clicking a printed box offers to put a cross in it', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  // The tick box's printed square, which is drawn into the widget rather than
  // being a page object, so the offer here comes from the page-level menu.
  await clickPdf(page, 500, 440, 'right');

  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /put a cross here/i })).toBeVisible();
  await menu.getByRole('menuitem', { name: /put a tick here/i }).click();

  await expect(page.getByText(/1 item not yet written to the file/i)).toBeVisible();
});

test('a placed mark can be removed again from its own menu', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  await page.getByRole('button', { name: 'Mark' }).click();
  await clickPdf(page, 500, 440);
  await expect(page.getByText(/1 item not yet written/i)).toBeVisible();

  await clickPdf(page, 500, 440, 'right');
  await page.getByRole('menuitem', { name: /remove this mark/i }).click();

  await expect(page.getByText(/not yet written/i)).toHaveCount(0);
});

test('a mark survives the round trip to a saved file', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  expect(await inkIn(page, BLANK)).toBe(0);

  await page.getByRole('button', { name: 'Mark' }).click();
  await clickPdf(page, 500, 440);
  await expect(page.getByText(/1 item not yet written/i)).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /^download$/i }).click();
  const download = await downloadPromise;

  const reopen = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^open$/i }).click();
  await (await reopen).setFiles(await download.path());
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(1500);

  // Drawn into the reopened file, not merely into the previous session's view.
  expect(await inkIn(page, BLANK)).toBeGreaterThan(0);
});
