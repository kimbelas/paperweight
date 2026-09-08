import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

/**
 * Reading and editing a scanned page.
 *
 * `scanned-text.pdf` is a real document rendered to a bitmap, so its words are
 * genuine glyph shapes with no text objects behind them. That distinction
 * matters: the older `scanned-page.pdf` fixture is grey bars, and a recogniser
 * correctly finds nothing in it, which is indistinguishable from a broken
 * recogniser.
 *
 * OCR is slow on first run because it loads a language model, so these tests
 * are given generous time.
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
  await expect(page.getByRole('heading', { name: /open a pdf to edit/i })).toBeVisible();
  return errors;
}

async function openFixture(page: Page, fixture: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, fixture));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });
}

/** Read the page and wait for the result. */
async function readPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: /read this page/i }).click();
  await expect(page.getByText(/Found\s+\d+\s+lines?/i)).toBeVisible({ timeout: 180_000 });
}

/** Click a point given in PDF coordinates on a 612x792 page. */
async function clickPdfPoint(page: Page, pdfX: number, pdfY: number): Promise<void> {
  const box = (await page.locator('canvas[aria-label="Page 1"]').boundingBox())!;
  await page.mouse.click(
    box.x + pdfX * (box.width / 612),
    box.y + (792 - pdfY) * (box.height / 792),
  );
}

test('says a scan has no text, and offers to read it', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'scanned-text.pdf');

  // The honest disclosure comes before the offer, not after the attempt.
  await expect(page.getByText(/is a picture, so there is no text to edit/i)).toBeVisible();
  await expect(page.getByText(/paints over the original/i)).toBeVisible();
  await expect(page.getByText(/covered pixels stay in the file/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /read this page/i })).toBeVisible();
});

test('reads a scanned page without contacting anything', async ({ page }) => {
  // OCR would fetch its worker, core and language model from a CDN by default.
  // All three are served locally, and this is what holds that in place: the
  // whole promise of the app is that nothing leaves the device.
  const external: string[] = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (
      !url.startsWith('http://127.0.0.1:4173') &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:')
    ) {
      external.push(url);
    }
    await route.continue();
  });

  const errors = await openApp(page);
  await openFixture(page, 'scanned-text.pdf');
  await readPage(page);

  expect(external).toEqual([]);
  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});

test('reads the words on the page and reports its confidence', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'scanned-text.pdf');
  await readPage(page);

  await page.getByText(/show what was read/i).click();
  const list = page.locator('aside details ul');
  await expect(list).toBeVisible();

  // The source document's own lines, recovered from the picture.
  const text = await list.innerText();
  expect(text).toContain('Invoice INV-2024-001');
  expect(text).toContain('Acme Corporation');
  expect(text).toContain('45,000.00');

  // And a confidence figure, so the reading is not presented as fact.
  // Scoped to the scan section: the status bar shows a zoom percentage too.
  const scanSection = page.getByRole('region', { name: 'Text on this scan' });
  await expect(scanSection.getByText(/\d+%/)).toBeVisible();
});

test('replaces a line on a scan by painting over it', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'scanned-text.pdf');
  await readPage(page);

  // The "Billed to" line sits at y=660 in the source document.
  await clickPdfPoint(page, 150, 662);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(input).toHaveValue(/Acme Corporation/);
  // The hint says what will happen, which differs from editing real text.
  await expect(page.getByText(/paint over and replace/i)).toBeVisible();

  await input.fill('Billed to: Someone Else');
  await input.press('Enter');
  await expect(input).toHaveCount(0);

  // Committed as an undoable action, and disclosed as a patch rather than an
  // edit.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });
  await expect(page.getByText(/covered and redrawn/i)).toBeVisible();
});

test('a replaced line becomes real text that can be edited normally', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'scanned-text.pdf');
  await readPage(page);

  await clickPdfPoint(page, 150, 662);
  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill('Now real text');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });

  // Clicking it again edits the text object that now exists, rather than
  // painting over the patch a second time. This was broken at first: one edit
  // flipped the page to "has text" and stranded every other recognised line.
  await clickPdfPoint(page, 120, 662);
  const again = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(again).toBeVisible({ timeout: 20_000 });
  await expect(again).toHaveValue(/Now real text/);
  await expect(page.getByText(/paint over and replace/i)).toHaveCount(0);
});

test('the other recognised lines stay editable after one is replaced', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'scanned-text.pdf');
  await readPage(page);

  await clickPdfPoint(page, 150, 662);
  const first = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(first).toBeVisible({ timeout: 20_000 });
  await first.fill('Changed');
  await first.press('Enter');
  await expect(first).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 40_000 });

  // A different recognised line — "Amount due" at y=640 — must still work.
  await clickPdfPoint(page, 150, 642);
  const second = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(second).toBeVisible({ timeout: 20_000 });
  await expect(second).toHaveValue(/45,000|Amount/i);
});
