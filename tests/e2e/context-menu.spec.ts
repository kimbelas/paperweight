import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * The pointer, and what it offers.
 *
 * Three things are covered here, all of them interface behaviour that the
 * engine tests cannot see.
 *
 * A click on a form field opens it for editing whatever tool is armed. This
 * used to require picking the Edit text tool first, and a form that does
 * nothing when you click it reads as a form that cannot be filled in.
 *
 * A right-click offers what can be done to the thing under it — which is the
 * only place the interface can say "this is a tick box" or "this is a shape",
 * since none of that fits in a permanent panel.
 *
 * And the pages rail keeps every thumbnail on one alignment, including once
 * the rail is long enough to grow a scrollbar. That last one is a regression
 * test with a specific bug behind it: the thumbnails were sized to a fixed
 * pixel width inside a container that lost ten pixels to the scrollbar, so
 * they overflowed their own cards and shifted the moment a document was long
 * enough to scroll.
 */

const FIXTURES = join(process.cwd(), 'fixtures');

/** The surname value, in PDF points on a 612x792 page. */
const SURNAME_RECT = { left: 250, bottom: 656, right: 460, top: 674 };

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
  await waitForLanding(page);
  return errors;
}

async function openFixture(page: Page, fixture: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, fixture));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(1200);
}

/** Point at a place on the page given in PDF coordinates. */
async function pointAt(page: Page, pdfX: number, pdfY: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('canvas[aria-label="Page 1"]').boundingBox())!;
  return {
    x: box.x + pdfX * (box.width / 612),
    y: box.y + (792 - pdfY) * (box.height / 792),
  };
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

test('clicking a form field edits it without picking a tool first', async ({ page }) => {
  const errors = await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  // Select is the tool the app opens with, and nothing here changes it.
  await expect(page.getByRole('button', { name: 'Select' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const { x, y } = await pointAt(page, 350, 665);
  await page.mouse.click(x, y);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(/DOE/i);

  expect(errors).toEqual([]);
});

test('right-clicking a field offers what can be done to it', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  const { x, y } = await pointAt(page, 350, 665);
  await page.mouse.click(x, y, { button: 'right' });

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /edit this value/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /widen to fit/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /delete this field/i })).toBeVisible();

  // Escape dismisses it without doing anything.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('Clear this value empties the field on the page', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  expect(await inkIn(page, SURNAME_RECT)).toBeGreaterThan(0);

  const { x, y } = await pointAt(page, 350, 665);
  await page.mouse.click(x, y, { button: 'right' });
  await page.getByRole('menuitem', { name: /clear this value/i }).click();

  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });
  await page.waitForTimeout(800);
  expect(await inkIn(page, SURNAME_RECT)).toBe(0);
});

test('right-clicking a ticked box offers to untick it', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  const CHECKBOX = { left: 240, bottom: 536, right: 256, top: 552 };
  expect(await inkIn(page, CHECKBOX)).toBeGreaterThan(0);

  // The mark sits in the same horizontal band as the "Female" caption beside
  // it, which is exactly the case the menu's hit order exists to get right.
  const { x, y } = await pointAt(page, 248, 544);
  await page.mouse.click(x, y, { button: 'right' });

  const untick = page.getByRole('menuitem', { name: /untick this box/i });
  await expect(untick).toBeVisible();
  await untick.click();

  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });
  await page.waitForTimeout(800);
  expect(await inkIn(page, CHECKBOX)).toBeLessThan(await inkIn(page, SURNAME_RECT));
});

test('right-clicking a line of text offers to copy or delete it', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  // The form's title, which is page text rather than a field.
  const { x, y } = await pointAt(page, 300, 735);
  await page.mouse.click(x, y, { button: 'right' });

  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /edit this text/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /copy this text/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /delete this line/i })).toBeVisible();
});

test('right-clicking blank page offers page actions', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  // Below the last field and still on screen, where nothing is drawn.
  const { x, y } = await pointAt(page, 520, 430);
  await page.mouse.click(x, y, { button: 'right' });

  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /add text here/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /rotate this page/i })).toBeVisible();
});

test('right-clicking a page in the rail can rotate it', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'multipage.pdf');

  const before = await page.locator('canvas[aria-label="Page 1"]').boundingBox();

  await page.getByRole('button', { name: /^Page 1$/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /rotate 90/i }).click();

  // A quarter turn swaps the page's proportions, which is visible in the
  // canvas itself rather than only in the file.
  await expect
    .poll(
      async () => {
        const box = await page.locator('canvas[aria-label="Page 1"]').boundingBox();
        return box ? box.width / box.height : 0;
      },
      { timeout: 40_000 },
    )
    .toBeGreaterThan(before!.width / before!.height);
});

test('every thumbnail in the rail keeps the same footprint', async ({ page }) => {
  // Short enough that the rail has to scroll, which is the case that used to
  // knock the thumbnails out of alignment.
  await page.setViewportSize({ width: 1440, height: 560 });
  await openApp(page);
  await openFixture(page, 'multipage.pdf');

  const thumbs = page.getByRole('button', { name: /^Page \d+(, a scanned image)?$/ });
  const count = await thumbs.count();
  expect(count).toBeGreaterThan(2);

  const lefts = new Set<number>();
  const widths = new Set<number>();

  for (let i = 0; i < count; i++) {
    const card = (await thumbs.nth(i).boundingBox())!;
    lefts.add(Math.round(card.x));
    widths.add(Math.round(card.width));

    // The page image has to sit inside its own card. It overflowing was what
    // the misalignment actually looked like.
    const canvas = (await thumbs.nth(i).locator('canvas').boundingBox())!;
    expect(canvas.width).toBeLessThanOrEqual(card.width);
    expect(canvas.x).toBeGreaterThanOrEqual(card.x - 1);
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(card.x + card.width + 1);
  }

  expect([...lefts]).toHaveLength(1);
  expect([...widths]).toHaveLength(1);
});
