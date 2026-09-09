import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * Dragging, and editing text that lives inside a form XObject.
 *
 * Both of these were reported broken against a real document: a filled bank
 * form had every line uneditable, and there was no way to reposition anything.
 * These tests hold the fixes in place from the browser side, where the user
 * actually meets them.
 */

const FIXTURES = join(process.cwd(), 'fixtures');

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

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
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });
}

/** Click a point given in PDF coordinates on a 612x792 page. */
async function clickPdfPoint(page: Page, pdfX: number, pdfY: number): Promise<void> {
  const box = (await page.locator('canvas[aria-label="Page 1"]').boundingBox())!;
  await page.mouse.click(
    box.x + pdfX * (box.width / 612),
    box.y + (792 - pdfY) * (box.height / 792),
  );
}

test('selects a whole line of text, not one word of it', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'kerned-tj.pdf');

  await page
    .getByRole('button', { name: /select/i })
    .first()
    .click();
  // "Waterfall Project" is emitted as many kerned text objects. Selecting one
  // of them and dragging it would pull letters out of the middle of a word.
  await clickPdfPoint(page, 100, 704);

  const outline = page.locator('[role="group"][aria-label^="Selected:"]');
  await expect(outline).toBeVisible();
  await expect(outline).toHaveAttribute('aria-label', /Waterfall Project/);
});

test('drags a line of text to a new position', async ({ page }) => {
  const errors = await openApp(page);
  await openFixture(page, 'simple-text.pdf');

  await page
    .getByRole('button', { name: /select/i })
    .first()
    .click();
  await clickPdfPoint(page, 100, 664);

  const outline = page.locator('[role="group"][aria-label^="Selected:"]');
  await expect(outline).toBeVisible();
  await expect(outline).toHaveAttribute('aria-label', /Acme Corporation/);

  const before = (await outline.boundingBox())!;

  // The drag is in CSS pixels but the assertions below are in PDF points, and
  // the page is displayed at a fit-width zoom rather than 1:1. Convert rather
  // than assume, or the expected landing spot is wrong by the zoom factor.
  const canvas = (await page.locator('canvas[aria-label="Page 1"]').boundingBox())!;
  const scaleX = canvas.width / 612;
  const scaleY = canvas.height / 792;
  const dragCssX = 70;
  const dragCssY = 45;

  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    before.x + before.width / 2 + dragCssX,
    before.y + before.height / 2 + dragCssY,
    { steps: 10 },
  );
  // Mid-drag the outline previews the new position and says what will happen.
  await expect(page.getByText('Release to place')).toBeVisible();
  await page.mouse.up();

  // The move is a committed, undoable action.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });

  // The text is now where it was dropped, so clicking the old spot finds
  // nothing and clicking the new one finds it.
  await clickPdfPoint(page, 100, 664);
  await expect(page.locator('[role="group"][aria-label*="Acme"]')).toHaveCount(0);

  await clickPdfPoint(page, 100 + dragCssX / scaleX, 664 - dragCssY / scaleY);
  await expect(page.locator('[role="group"][aria-label*="Acme"]')).toBeVisible();

  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});

test('a click that barely wobbles does not move anything', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'simple-text.pdf');

  await page
    .getByRole('button', { name: /select/i })
    .first()
    .click();
  await clickPdfPoint(page, 100, 664);

  const outline = page.locator('[role="group"][aria-label^="Selected:"]');
  await expect(outline).toBeVisible();
  const box = (await outline.boundingBox())!;

  await page.mouse.move(box.x + 10, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 11, box.y + 6);
  await page.mouse.up();

  // Selecting something must not nudge it and leave an undo entry behind.
  await page.waitForTimeout(800);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('edits text inside a form XObject', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'form-xobject-text.pdf');

  await page.getByRole('button', { name: /edit text/i }).click();
  // This line lives inside a form XObject. It used to be refused outright,
  // which left documents built as one big form entirely uneditable.
  await clickPdfPoint(page, 150, 622);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(/inside the form/i);

  // And the editor is sized in rendered points, so it is legible rather than
  // collapsed to a pixel.
  const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThan(8);

  await input.fill('Now editable');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });

  // Reopening the edited line shows the new text, which means it was written.
  await clickPdfPoint(page, 120, 622);
  const again = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(again).toBeVisible();
  await expect(again).toHaveValue(/Now editable/);
});

test('does not list whitespace-only runs as editable lines', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'simple-text.pdf');

  await page.getByRole('button', { name: /edit text/i }).click();
  // Empty margin. Nothing should open, and in particular no zero-width
  // whitespace run should claim the click.
  await clickPdfPoint(page, 560, 400);
  await page.waitForTimeout(500);
  await expect(page.getByRole('textbox', { name: /edit this line of text/i })).toHaveCount(0);
});
