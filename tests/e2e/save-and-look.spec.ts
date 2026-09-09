import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * The save round-trip, and screenshots of the working app.
 *
 * The download test closes the loop that matters most: an edit made in the UI
 * has to come back out as bytes a PDF reader will accept, with the change in
 * it. Everything up to that point could be true while the saved file is
 * still wrong.
 */

const FIXTURES = join(process.cwd(), 'fixtures');
const SHOTS = join(process.cwd(), 'test-results', 'screens');

async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await waitForLanding(page);
}

async function openFixture(page: Page, fixture: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, fixture));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });
}

test('an edit survives the round trip to a saved file', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'simple-text.pdf');

  // Edit the amount line.
  await page.getByRole('button', { name: /edit text/i }).click();
  const canvas = page.locator('canvas[aria-label="Page 1"]');
  const box = (await canvas.boundingBox())!;
  const scaleY = box.height / 792;
  await page.mouse.click(box.x + 100 * (box.width / 612), box.y + (792 - 644) * scaleY);

  const input = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input).toBeVisible();
  await input.fill('Amount due: PHP 12,345.67');
  await input.press('Enter');
  await expect(input).toHaveCount(0);

  // Download it.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /^download$/i }).click();
  const download = await downloadPromise;

  await mkdir(SHOTS, { recursive: true });
  const saved = join(SHOTS, 'edited.pdf');
  await download.saveAs(saved);

  const bytes = await readFile(saved);
  // A real PDF, and big enough to contain an embedded fallback font.
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(2000);

  // The suggested filename says it is a copy, so the original is not shadowed.
  expect(download.suggestedFilename()).toMatch(/\(edited\)\.pdf$/);

  // Re-open the saved file in the app itself: the change must be there, and
  // the file must still parse.
  const reopen = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^open$/i }).click();
  await (await reopen).setFiles(saved);
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });

  // Click the same line and read what the editor loads into its input.
  await page.getByRole('button', { name: /edit text/i }).click();
  const box2 = (await page.locator('canvas[aria-label="Page 1"]').boundingBox())!;
  await page.mouse.click(
    box2.x + 100 * (box2.width / 612),
    box2.y + (792 - 644) * (box2.height / 792),
  );
  const input2 = page.getByRole('textbox', { name: /edit this line of text/i });
  await expect(input2).toBeVisible();
  await expect(input2).toHaveValue(/12,345\.67/);
});

test('screenshots the app in its main states', async ({ page }) => {
  await mkdir(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  await openApp(page);
  await page.screenshot({ path: join(SHOTS, '01-empty.png') });

  await openFixture(page, 'flattened-signature.pdf');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, '02-open-with-signature.png') });

  await page.getByRole('button', { name: /edit text/i }).click();
  const canvas = page.locator('canvas[aria-label="Page 1"]');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 120 * (box.width / 612), box.y + (792 - 698) * (box.height / 792));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, '03-editing-text.png') });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^signature$/i }).click();
  const dialog = page.getByRole('dialog', { name: /add a signature/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'type', exact: true }).click();
  await dialog.getByRole('textbox', { name: /name to render/i }).fill('Jane Doe');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(SHOTS, '04-signature-modal.png') });

  await dialog.getByRole('button', { name: /place on page/i }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, '05-signature-placed.png') });

  // Dark mode, since the theme claims to support it. Through the toggle
  // rather than by emulating a dark system: the app deliberately does not
  // follow `prefers-color-scheme`, so emulating one would silently screenshot
  // the light theme under a filename saying otherwise.
  await page.getByRole('button', { name: /switch to the dark theme/i }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, '06-dark.png') });

  await writeFile(join(SHOTS, 'README.txt'), 'Screenshots from the e2e run.\n');
});
