import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * A filled form, in the browser.
 *
 * Two things are being pinned here, and they failed independently.
 *
 * The values have to be *visible*: they live in the form rather than in the
 * page's content stream, and PDFium draws them only in a second pass through
 * the form-fill environment. Without it a completed form renders as a blank
 * one — which looked, to the person who reported it, like the app losing
 * their answers, since printing the same file showed every value.
 *
 * And they have to be *editable*: the text hit test cannot see a field
 * value, so clicking one used to do nothing at all. Field editing has its own
 * path, and the field hit test runs first, because a label shares a baseline
 * with the box holding its answer.
 */

const FIXTURES = join(process.cwd(), 'fixtures');

/** The Surname widget's /Rect, and the label to its left. */
const SURNAME_VALUE = { x: 300, y: 665 };
const NATIONALITY_LABEL = { x: 100, y: 583 };
const FEMALE_BOX = { x: 248, y: 544 };

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

async function openForm(page: Page): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, 'filled-form.pdf'));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });
}

/** Click a point given in PDF coordinates on a 612x792 page. */
async function clickPdf(page: Page, pdfX: number, pdfY: number): Promise<void> {
  const box = (await page.locator('canvas[aria-label="Page 1"]').boundingBox())!;
  await page.mouse.click(
    box.x + pdfX * (box.width / 612),
    box.y + (792 - pdfY) * (box.height / 792),
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

const SURNAME_RECT = { left: 250, bottom: 656, right: 460, top: 674 };
const CHECKBOX_RECT = { left: 240, bottom: 536, right: 256, top: 552 };

test('draws the values stored in the form', async ({ page }) => {
  const errors = await openApp(page);
  await openForm(page);

  // A field with no appearance stream of its own, one that has one, and a
  // ticked box. All three come from the form, none from the page.
  expect(await inkIn(page, SURNAME_RECT)).toBeGreaterThan(0);
  expect(await inkIn(page, { left: 250, bottom: 576, right: 460, top: 594 })).toBeGreaterThan(0);
  expect(await inkIn(page, CHECKBOX_RECT)).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('edits a field value and repaints the page', async ({ page }) => {
  await openApp(page);
  await openForm(page);

  const before = await inkIn(page, SURNAME_RECT);

  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, SURNAME_VALUE.x, SURNAME_VALUE.y);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(input).toHaveValue('DOE');

  // The interface says which field, rather than calling it a line of text.
  await expect(page.getByText(/Enter to update the .*Surname.* field/i)).toBeVisible();

  await input.fill('DOE-WHITFIELD');
  await input.press('Enter');
  await expect(input).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });
  await expect.poll(() => inkIn(page, SURNAME_RECT), { timeout: 30_000 }).not.toBe(before);

  // And the stored value is the new one, not just the drawn pixels.
  await clickPdf(page, SURNAME_VALUE.x, SURNAME_VALUE.y);
  const again = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(again).toBeVisible({ timeout: 20_000 });
  await expect(again).toHaveValue('DOE-WHITFIELD');
});

test('clicking a label still edits the label, not the field beside it', async ({ page }) => {
  await openApp(page);
  await openForm(page);

  // The label shares a baseline with the box holding its answer, which is why
  // the field hit test has to be exact and has to run first.
  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, NATIONALITY_LABEL.x, NATIONALITY_LABEL.y);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(input).toHaveValue(/Nationality or citizenship/);
  await expect(page.getByText(/Enter to update the .* field/i)).toHaveCount(0);
});

test('ticking a box toggles it rather than opening an editor', async ({ page }) => {
  await openApp(page);
  await openForm(page);

  const before = await inkIn(page, CHECKBOX_RECT);

  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, FEMALE_BOX.x, FEMALE_BOX.y);

  // No text editor for a box: a click does what a click does in any viewer.
  await expect(page.getByRole('textbox', { name: /edit this line of text/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });
  await expect.poll(() => inkIn(page, CHECKBOX_RECT), { timeout: 30_000 }).not.toBe(before);
});

/**
 * Widening a field.
 *
 * A field clips its appearance to its own rectangle, so a value wider than
 * the box is cut off in the file — on screen and on paper alike. The width is
 * therefore part of the document, and adjustable.
 */

const LONG_VALUE = 'DOE-WHITFIELD Y HARTLEY OF ASHFORD';
/** Past the Surname widget's right edge at x=460: only a wider field reaches here. */
const BEYOND_OLD_EDGE = { left: 462, bottom: 656, right: 600, top: 674 };

async function startEditingSurname(page: Page): Promise<void> {
  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, SURNAME_VALUE.x, SURNAME_VALUE.y);
  await expect(page.getByRole('textbox', { name: /edit this line of text/i })).toBeVisible({
    timeout: 20_000,
  });
}

test('warns that a value too wide for its field will be cut off', async ({ page }) => {
  await openApp(page);
  await openForm(page);
  await startEditingSurname(page);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await input.fill(LONG_VALUE);

  await expect(page.getByText(/cut off when printed/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /widen to fit/i })).toBeVisible();

  // A value that fits says nothing.
  await input.fill('DOE');
  await expect(page.getByText(/cut off when printed/i)).toHaveCount(0);
});

test('dragging the right edge widens the field so the value is not clipped', async ({ page }) => {
  await openApp(page);
  await openForm(page);

  expect(await inkIn(page, BEYOND_OLD_EDGE)).toBe(0);

  await startEditingSurname(page);
  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await input.fill(LONG_VALUE);

  const handle = page.getByRole('separator', { name: /drag to change the field width/i });
  await expect(handle).toBeVisible();

  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 260, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  // The hint reports the width that will be applied.
  await expect(page.getByText(/pt wide/i)).toBeVisible();

  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });

  // Ink past the field's old right edge can only be there because the field
  // itself is wider now.
  await expect.poll(() => inkIn(page, BEYOND_OLD_EDGE), { timeout: 30_000 }).toBeGreaterThan(0);

  // And the whole value is held, no longer clipped.
  await clickPdf(page, SURNAME_VALUE.x, SURNAME_VALUE.y);
  const again = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(again).toBeVisible({ timeout: 20_000 });
  await expect(again).toHaveValue(LONG_VALUE);
  await expect(page.getByText(/cut off when printed/i)).toHaveCount(0);
});

test('Widen to fit sizes the field to the value in one click', async ({ page }) => {
  await openApp(page);
  await openForm(page);
  await startEditingSurname(page);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await input.fill(LONG_VALUE);
  await expect(page.getByText(/cut off when printed/i)).toBeVisible();

  await page.getByRole('button', { name: /widen to fit/i }).click();

  // The warning goes because the box now holds the value.
  await expect(page.getByText(/cut off when printed/i)).toHaveCount(0);

  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });
  await expect.poll(() => inkIn(page, BEYOND_OLD_EDGE), { timeout: 30_000 }).toBeGreaterThan(0);
});

test('undo puts the field width back', async ({ page }) => {
  await openApp(page);
  await openForm(page);
  await startEditingSurname(page);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await input.fill(LONG_VALUE);
  await page.getByRole('button', { name: /widen to fit/i }).click();
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });
  await expect.poll(() => inkIn(page, BEYOND_OLD_EDGE), { timeout: 30_000 }).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => inkIn(page, BEYOND_OLD_EDGE), { timeout: 30_000 }).toBe(0);
});

/**
 * An edited field must not change size.
 *
 * `autosize-field.pdf` has a `/DA` of `0 Tf` — auto — while its appearance
 * stream draws at 9pt, and no `/NeedAppearances`. The original stream is used
 * as-is on open; editing rebuilds the appearance from `/DA`, where auto means
 * "fill the box height", giving 18pt on a 24pt widget. Reported from a real
 * visa form: one edited field came back in huge, widely-spaced type while
 * every untouched field around it still drew at 9pt.
 */
test('an edited field keeps the size it was drawn at', async ({ page }) => {
  await openApp(page);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, 'autosize-field.pdf'));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });

  /** Height of the value's ink, in points, inside the widget. */
  const inkHeight = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas[aria-label="Page 1"]') as HTMLCanvasElement;
      const sy = canvas.height / 792;
      const x0 = Math.floor(252 * (canvas.width / 612));
      const x1 = Math.floor(458 * (canvas.width / 612));
      const y0 = Math.floor((792 - 666) * sy);
      const y1 = Math.floor((792 - 638) * sy);
      const image = canvas.getContext('2d')!.getImageData(x0, y0, x1 - x0, y1 - y0);
      let rows = 0;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if (image.data[(y * image.width + x) * 4] < 140) {
            rows++;
            break;
          }
        }
      }
      return rows / sy;
    });

  const before = await inkHeight();
  expect(before).toBeGreaterThan(0);

  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, 320, 652);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill('BELAS 2');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });

  // Auto would have roughly doubled the type. Allow for the extra glyph and
  // for anti-aliasing, but nothing like a doubling.
  await expect.poll(() => inkHeight(), { timeout: 30_000 }).toBeLessThan(before * 1.5);
});

test('an edited field with no appearance of its own matches the rest of the form', async ({
  page,
}) => {
  await openApp(page);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, 'autosize-no-appearance.pdf'));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });

  /** Ink height in points inside a band of the page. */
  const inkHeight = (top: number, bottom: number) =>
    page.evaluate(
      ({ t, b }) => {
        const canvas = document.querySelector('canvas[aria-label="Page 1"]') as HTMLCanvasElement;
        const sy = canvas.height / 792;
        const sx = canvas.width / 612;
        const image = canvas
          .getContext('2d')!
          .getImageData(
            Math.floor(252 * sx),
            Math.floor((792 - t) * sy),
            Math.floor(206 * sx),
            Math.floor((t - b) * sy),
          );
        let rows = 0;
        for (let y = 0; y < image.height; y++) {
          for (let x = 0; x < image.width; x++) {
            if (image.data[(y * image.width + x) * 4] < 140) {
              rows++;
              break;
            }
          }
        }
        return rows / sy;
      },
      { t: top, b: bottom },
    );

  // GivenNames draws from the file's own 9pt appearance and is the reference.
  const reference = await inkHeight(624, 600);
  expect(reference).toBeGreaterThan(0);

  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, 320, 652);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill('DOE-edited');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });

  // The edited field must now sit at the same type size as its neighbour, not
  // at the auto size that filled the box.
  await expect.poll(() => inkHeight(666, 638), { timeout: 30_000 }).toBeLessThan(reference * 1.6);

  // And the whole value is there, since it is no longer too wide to fit.
  await clickPdf(page, 320, 652);
  const again = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(again).toBeVisible({ timeout: 20_000 });
  await expect(again).toHaveValue('DOE-edited');
});

test('does not show a machine-generated field name to the user', async ({ page }) => {
  await openApp(page);
  await openForm(page);

  // The fixture's fields are properly named, so the name is used as-is; the
  // unit tests cover the generated-id cases. What matters here is that the
  // hint never shows a raw id-looking token.
  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, SURNAME_VALUE.x, SURNAME_VALUE.y);

  const hint = page.getByText(/Enter to update/i);
  await expect(hint).toBeVisible({ timeout: 20_000 });
  await expect(hint).toHaveText(/Surname/);
  await expect(hint).not.toHaveText(/dhFormfield|\d{6,}/);
});

test('a form edit survives the round trip to a saved file', async ({ page }) => {
  await openApp(page);
  await openForm(page);

  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, SURNAME_VALUE.x, SURNAME_VALUE.y);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill('SAVED VALUE');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /^download$/i }).click();
  const download = await downloadPromise;

  const reopen = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^open$/i }).click();
  await (await reopen).setFiles(await download.path());
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(1000);

  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, SURNAME_VALUE.x, SURNAME_VALUE.y);
  const saved = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(saved).toBeVisible({ timeout: 20_000 });
  await expect(saved).toHaveValue('SAVED VALUE');
});

/**
 * The editor shows the value at the size the document draws it.
 *
 * Reported as "it zooms": clicking a field whose value is drawn at 9pt opened
 * an editor showing it at 14pt, so the value appeared to swell the moment it
 * was touched. The editor had been guessing the size from the widget's height,
 * and a 24pt-tall box on a form set in 9pt is ordinary — the two are
 * unrelated. Everything measured off that preview inherited the error: the
 * "this will be cut off" warning fired on values that fit, and "Widen to fit"
 * sized the box to text half again as wide as the real thing.
 */
test('the field editor draws the value at the document’s own size', async ({ page }) => {
  await openApp(page);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, 'autosize-field.pdf'));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, 320, 652);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(input).toHaveValue('BELAS');

  // CSS pixels per PDF point, read off the canvas rather than assumed, so the
  // assertion holds at whatever zoom "fit width" lands on.
  const { perPoint, typePx } = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="Page 1"]') as HTMLCanvasElement;
    const field = document.querySelector('.text-edit-input') as HTMLInputElement;
    return {
      perPoint: canvas.getBoundingClientRect().width / 612,
      typePx: parseFloat(getComputedStyle(field).fontSize),
    };
  });

  // The document draws this value at 9pt. The old guess from the 24pt box was
  // 14pt, so anything above about 11 is that bug back.
  expect(typePx).toBeGreaterThan(8 * perPoint);
  expect(typePx).toBeLessThan(10.5 * perPoint);
});

test('a field that will not be clipped is not offered a width', async ({ page }) => {
  await openApp(page);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, 'autosize-field.pdf'));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, 320, 652);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill('BELAS'.repeat(20));

  // This field's value is drawn into the page rather than left in the form,
  // and page text runs on. Offering to widen a box that will not clip, and
  // warning about a cut that will not happen, is the interface saying
  // something the file does not do.
  await expect(page.getByText(/cut off when printed/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /widen to fit/i })).toHaveCount(0);
  await expect(page.getByRole('separator', { name: /field width/i })).toHaveCount(0);

  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });

  // And the whole value really is in the page, uncut.
  await clickPdf(page, 300, 652);
  const again = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(again).toBeVisible({ timeout: 20_000 });
  await expect(again).toHaveValue('BELAS'.repeat(20));
});

/**
 * Editing a field on a phone.
 *
 * At the zoom that fits a page to a 390px screen, a 9pt field is six pixels
 * of type in a six-pixel box: tapping it opened an editor that was focused,
 * selected and ready, and looked exactly like nothing having happened. The
 * type is floored at 16px on a touch screen — the size below which mobile
 * Safari also zooms the viewport on focus — and the box grows in height to
 * hold it.
 *
 * In height and not in width: scaling the width too made the box wider than
 * the screen, and focusing it dragged the whole document sideways with the
 * form's own labels off the left-hand edge. That is what the last assertion
 * here is for.
 */
test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tapping a field opens an editor you can read', async ({ page }) => {
    await openApp(page);
    await openForm(page);

    const canvas = page.locator('canvas[aria-label="Page 1"]');
    const box = (await canvas.boundingBox())!;
    await page.touchscreen.tap(
      box.x + SURNAME_VALUE.x * (box.width / 612),
      box.y + (792 - SURNAME_VALUE.y) * (box.height / 792),
    );

    const input = page.getByRole('textbox', { name: /edit this line of text/i });
    await expect(input).toBeVisible({ timeout: 20_000 });
    await expect(input).toHaveValue('DOE');

    const shown = await page.evaluate(() => {
      const field = document.querySelector('.text-edit-input') as HTMLInputElement;
      const rect = field.getBoundingClientRect();
      return {
        typePx: parseFloat(getComputedStyle(field).fontSize),
        heightPx: rect.height,
        focused: document.activeElement === field,
      };
    });

    // 16px is the floor, and it is the whole point: under it the type cannot
    // be read and mobile Safari zooms the page out from under the user.
    expect(shown.typePx).toBeGreaterThanOrEqual(16);
    expect(shown.heightPx).toBeGreaterThan(16);
    expect(shown.focused).toBe(true);

    // Typing still reaches it, and the hint stays on the screen rather than
    // running off the right-hand edge with half of it out of sight.
    await input.fill('DOE-WHITFIELD');
    await expect(input).toHaveValue('DOE-WHITFIELD');

    const overhang = await page.evaluate(() => {
      const hint = [...document.querySelectorAll('div')].find((d) =>
        d.textContent?.startsWith('Enter to update'),
      )!;
      return hint.getBoundingClientRect().right - window.innerWidth;
    });
    expect(overhang).toBeLessThanOrEqual(0);

    // And nothing about opening an editor may drag the document sideways.
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sideways).toBe(0);
  });
});
