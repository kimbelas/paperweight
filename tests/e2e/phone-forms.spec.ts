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

test('a fixed combo opens a list of its options and saves the choice', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'form-kinds.pdf');

  await tapPdf(page, 280, 669);
  await tapPdf(page, 280, 669);
  const select = page.getByRole('combobox', { name: /choose/i });
  await expect(select).toBeVisible({ timeout: 20_000 });
  await select.selectOption('Canada');

  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });
  await expect(select).toHaveCount(0);
});

/** A one-finger drag through CDP. Chromium only: WebKit has no touch input API. */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const point = (p: { x: number; y: number }) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) });
  for (let i = 1; i <= 12; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(p) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('a finger drags a selected field', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Touch drags are driven through CDP.');
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  await tapPdf(page, 300, 665);
  await expect(outline(page)).toBeVisible();
  const box = (await outline(page).boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touchDrag(page, from, { x: from.x, y: from.y + 40 });

  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });
  const after = (await outline(page).boundingBox())!;
  expect(after.y).toBeGreaterThan(box.y + 20);
});

test('a drifting second tap opens the field instead of nudging it', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Touch drags are driven through CDP.');
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  await tapPdf(page, 300, 665);
  const box = (await outline(page).boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touchDrag(page, from, { x: from.x + 5, y: from.y + 4 });

  await expect(page.getByRole('textbox', { name: /edit this line of text/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('a tap just below a small field reaches the field, not its label', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  // Surname's box is 656..674; at this zoom 3pt below it is a few pixels away.
  await tapPdf(page, 300, 653);
  await expect(outline(page)).toHaveAttribute('aria-label', /Surname/);
});

const editor = (page: Page) => page.getByRole('textbox', { name: /edit this line of text/i });

test('Widen to fit widens the field on a phone', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');
  await tapPdf(page, 300, 665);
  await tapPdf(page, 300, 665);
  await expect(editor(page)).toBeVisible({ timeout: 20_000 });
  await editor(page).fill('DOE-WHITFIELD Y HARTLEY OF ASHFORD');

  const before = (await editor(page).boundingBox())!.width;
  await page.getByRole('button', { name: 'Widen to fit' }).tap();
  await expect.poll(async () => (await editor(page).boundingBox())!.width).toBeGreaterThan(before);
  await expect(editor(page)).toBeVisible();
});

test('Done commits and Cancel discards', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  await tapPdf(page, 300, 665);
  await tapPdf(page, 300, 665);
  await editor(page).fill('KEPT');
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });

  await tapPdf(page, 300, 625);
  await tapPdf(page, 300, 625);
  await editor(page).fill('DISCARDED');
  await page.getByRole('button', { name: 'Cancel' }).tap();
  await expect(editor(page)).toHaveCount(0);

  // Reopen GivenNames: still the original value.
  await tapPdf(page, 300, 625);
  await tapPdf(page, 300, 625);
  await expect(editor(page)).toHaveValue('JANE ANNE ELIZABETH DOE');
});

test('commits the first field when another is tapped', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');
  // Edit text tool, so one tap opens a field.
  await page.getByRole('button', { name: 'Actions rail' }).click();
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();

  await tapPdf(page, 300, 665);
  await editor(page).fill('FIRST');
  await tapPdf(page, 300, 625);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });

  await page.keyboard.press('Escape');
  await tapPdf(page, 300, 665);
  await expect(editor(page)).toHaveValue('FIRST');
});

test('the editor chip stays on screen for a field on the right', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'form-kinds.pdf');
  // Shared kid 2 sits at x 320..420 on a 612pt page: the right third.
  await tapPdf(page, 370, 408);
  await tapPdf(page, 370, 408);
  await expect(editor(page)).toBeVisible({ timeout: 20_000 });

  const overflow = await page.evaluate(() => {
    const done = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Done')!;
    return done.closest('div')!.getBoundingClientRect().right - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
});

test('with no blur, as on iOS, the next field opens and the first commits', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');
  await page.getByRole('button', { name: 'Actions rail' }).click();
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();

  await tapPdf(page, 300, 665);
  await editor(page).fill('FIRST');
  // iOS sends no blur when the tap lands on something that cannot take
  // focus, so the editor is replaced without ever losing focus.
  await page.evaluate(() => {
    for (const type of ['focusout', 'blur'])
      window.addEventListener(type, (event) => event.stopImmediatePropagation(), true);
  });
  await tapPdf(page, 300, 625);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });
  await expect(editor(page)).toHaveValue('JANE ANNE ELIZABETH DOE');
});

test('the Enter that confirms an IME composition does not commit', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');
  await tapPdf(page, 300, 665);
  await tapPdf(page, 300, 665);
  await expect(editor(page)).toBeVisible({ timeout: 20_000 });
  await editor(page).fill('DOE-SAN');

  // WebKit ends the composition before this keydown, so `isComposing` is
  // false and only keyCode 229 marks it.
  await editor(page).evaluate((input) =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }),
    ),
  );
  await page.waitForTimeout(500);
  await expect(editor(page)).toHaveValue('DOE-SAN');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('a selected field offers Edit and Delete on a phone, on screen', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'form-kinds.pdf');
  await tapPdf(page, 370, 408);
  await expect(outline(page)).toBeVisible();

  await expect(page.getByText('Tap again to edit')).toBeVisible();
  await expect(page.getByText(/Click again|Delete to remove/)).toHaveCount(0);

  const overflow = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('span,div')].find((n) =>
      n.textContent?.startsWith('Tap again to edit'),
    )!;
    return chip.getBoundingClientRect().right - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Delete', exact: true }).tap();
  await expect(outline(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });
});

test('picking the tool already active closes the drawer', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');
  await page.getByRole('button', { name: 'Actions rail' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close this panel' })).toHaveCount(0);

  // And the next tap lands on the page, selecting the field.
  await tapPdf(page, 300, 665);
  await expect(outline(page)).toBeVisible();
});

test('an action closes the drawer', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');
  await page.getByRole('button', { name: 'Actions rail' }).click();
  await page.getByRole('button', { name: 'Rotate 90°' }).click();
  await expect(page.getByRole('button', { name: 'Close this panel' })).toHaveCount(0);
});

test('Add text is readable on a phone', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');
  await page.getByRole('button', { name: 'Actions rail' }).click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await tapPdf(page, 100, 300);

  const size = await page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.querySelector('input[aria-label="Text to add to the page"]')!)
        .fontSize,
    ),
  );
  expect(size).toBeGreaterThanOrEqual(16);
});

test('only the newest notice shows on a phone', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'acroform-sig-field.pdf');
  // Opening a file with a signature field raises the signature notice.
  // Selecting the signature field (rect 72 150 300 220) and tapping it again
  // raises a second: "This is a signature field...".
  await tapPdf(page, 186, 185);
  await tapPdf(page, 186, 185);

  const cards = page.locator('[role="status"] > div');
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole('button', { name: /\+\d+ more/ })).toBeVisible();
});
