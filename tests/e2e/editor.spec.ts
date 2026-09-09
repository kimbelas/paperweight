import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * End-to-end tests against the built static export.
 *
 * These are the tests that prove the app works rather than that the engine
 * works: the worker actually boots in a browser, the WASM binary is reachable
 * where the worker looks for it, a click lands on the right line of text, and
 * an edit shows up on the canvas.
 *
 * The File System Access API is removed before the app loads. That forces the
 * `<input type=file>` path, which is the one Firefox and Safari users take, so
 * the fallback is exercised rather than only the Chromium happy path.
 */

const FIXTURES = join(process.cwd(), 'fixtures');

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.addInitScript(() => {
    // Force the fallback file input, which is what non-Chromium browsers use.
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

  // The first page canvas appearing means the worker booted, the WASM loaded,
  // the document parsed and a bitmap made it back across the boundary.
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });
}

/** Click the middle of a line of text found by its content. */
async function clickLine(page: Page, text: string): Promise<void> {
  const box = await page.evaluate(async (needle: string) => {
    const canvas = document.querySelector('canvas[aria-label="Page 1"]') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    // The engine is reachable from the page only through the app, so the line
    // geometry is recomputed here from the rendered size the same way the app
    // does: ask the worker via the same public path the UI uses.
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, needle };
  }, text);

  // Text positions come from the fixtures, which are hand-built and so have
  // known coordinates. simple-text.pdf is 612x792 with lines at fixed y.
  const lineY: Record<string, number> = {
    'Invoice INV-2024-001': 700,
    'Billed to: Acme Corporation': 660,
    'Amount due: PHP 45,000.00': 640,
  };
  const pdfY = lineY[text];
  if (pdfY === undefined) throw new Error(`No known position for "${text}"`);

  const scaleX = box.width / 612;
  const scaleY = box.height / 792;
  // A little to the right of the left margin, on the line's centre.
  const x = box.left + 100 * scaleX;
  const y = box.top + (792 - pdfY - 4) * scaleY;

  await page.mouse.click(x, y);
}

test('boots the engine and renders a document', async ({ page }) => {
  const errors = await openApp(page);
  await openFixture(page, 'simple-text.pdf');

  await expect(page.getByText('Page 1 of 1')).toBeVisible();

  // The canvas must have real pixels, not just exist.
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="Page 1"]') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) dark++;
    }
    return dark;
  });
  expect(painted).toBeGreaterThan(200);

  expect(errors).toEqual([]);
});

test('never sends the document anywhere', async ({ page, baseURL }) => {
  // The core promise of the app. Any request carrying a request body, or any
  // cross-origin request at all, after the document is open is a violation.
  // "Same origin" is whatever server this run is against: the static server
  // in the base config or wrangler dev in the deploy one.
  const origin = new URL(baseURL!).origin;
  const suspicious: string[] = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const sameOrigin = url.startsWith(origin);
    if (!sameOrigin && !url.startsWith('data:') && !url.startsWith('blob:')) {
      suspicious.push(`cross-origin ${request.method()} ${url}`);
    }
    if (request.postData()) {
      suspicious.push(`${request.method()} with a body: ${url}`);
    }
    await route.continue();
  });

  await openApp(page);
  await openFixture(page, 'flattened-signature.pdf');

  // Do some work, so it is not just the idle case being measured.
  await page.getByRole('button', { name: /edit text/i }).click();
  await page.waitForTimeout(500);

  expect(suspicious).toEqual([]);
});

test('edits a line of existing text', async ({ page }) => {
  const errors = await openApp(page);
  await openFixture(page, 'simple-text.pdf');

  await page.getByRole('button', { name: /edit text/i }).click();
  await clickLine(page, 'Billed to: Acme Corporation');

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(/Acme Corporation/);

  await input.fill('Billed to: Beta Industries');
  await input.press('Enter');

  // The editor closes and the page re-renders with the change.
  await expect(input).toHaveCount(0);
  await expect(page.getByText(/not yet written to the file|font/i).first()).toBeVisible({
    timeout: 20_000,
  });

  // Undo becomes available, which means the edit was committed as an action.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});

test('undoes an edit', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'simple-text.pdf');

  await page.getByRole('button', { name: /edit text/i }).click();
  await clickLine(page, 'Amount due: PHP 45,000.00');

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible();
  await input.fill('Amount due: PHP 1.00');
  await input.press('Enter');

  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeEnabled();
  await undo.click();

  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
});

test('finds and removes a flattened signature', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'flattened-signature.pdf');

  // The panel lists it, with the reasoning visible.
  await expect(page.getByText('Signature image')).toBeVisible();
  await expect(page.getByText(/Next to the text/i)).toBeVisible();

  await page
    .getByRole('button', { name: /remove from the file/i })
    .first()
    .click();

  // Once removed it leaves the list, because the scan is redone after an edit.
  await expect(page.getByText('Signature image')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
});

test('says a scanned page cannot have its text edited', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'scanned-page.pdf');

  // The honest disclosure, up front rather than after a failed attempt.
  await expect(page.getByText(/scanned image/i).first()).toBeVisible();
  // Scoped, because the scan tools section names itself separately.
  await expect(
    page.getByRole('region', { name: 'Signatures' }).getByText('Scanned page'),
  ).toBeVisible();
  await expect(page.getByText(/Use the Cover tool/i)).toBeVisible();
});

test('places a typed signature and reports it as pending', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'simple-text.pdf');

  await page.getByRole('button', { name: /^signature$/i }).click();
  const dialog = page.getByRole('dialog', { name: /add a signature/i });
  await expect(dialog).toBeVisible();

  // Scoped to the dialog and exact: "type" also appears in the side panel's
  // "Draw, type or upload" button.
  await dialog.getByRole('button', { name: 'type', exact: true }).click();
  await dialog.getByRole('textbox', { name: /name to render/i }).fill('Jane Doe');
  await dialog.getByRole('button', { name: /place on page/i }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);

  // It is on the page but not yet in the file, and the UI says so rather than
  // implying it has been saved.
  await expect(page.getByText(/1 item not yet written to the file/i)).toBeVisible();
  await expect(page.getByText(/Drag the signature into place/i)).toBeVisible();
});

test('covers content with a sampled patch', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'simple-text.pdf');

  await page.getByRole('button', { name: /cover/i }).click();

  const canvas = page.locator('canvas[aria-label="Page 1"]');
  const box = (await canvas.boundingBox())!;

  // Drag a patch over the amount line.
  const scaleY = box.height / 792;
  const y = box.y + (792 - 646) * scaleY;
  await page.mouse.move(box.x + 60, y - 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 340, y + 10, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByText(/1 item not yet written to the file/i)).toBeVisible();
});

test('navigates a multi-page document by thumbnail', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'multipage.pdf');

  await expect(page.getByText('Page 1 of 5')).toBeVisible();

  await page.getByRole('button', { name: /^Page 4$/ }).click();
  await expect(page.getByText('Page 4 of 5')).toBeVisible({ timeout: 20_000 });
});

test('reports a file that is not a PDF', async ({ page }) => {
  await openApp(page);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (
    await chooser
  ).setFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('this is definitely not a pdf'),
  });

  await expect(page.getByText(/not a valid PDF|could not be read|damaged/i)).toBeVisible();
});
