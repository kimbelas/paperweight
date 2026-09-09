import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * The editor at every width it will actually be opened at.
 *
 * This suite exists because the app was, for its whole life, unusable on a
 * phone in a way no test could see. The tool rail is a fixed 248px and the
 * pages rail a fixed 178px, both shown by default; at 390px that is 426px of
 * chrome, so the document pane was squeezed to nothing and the page pushed off
 * the right-hand edge. It still rendered, still reported a zoom, still
 * responded to every control — it was simply not on the screen. Every existing
 * spec ran at the Playwright default of 1280 and passed throughout.
 *
 * Below 900px the rails open over the document instead of beside it. What is
 * asserted here is that arrangement's two obligations: the page never scrolls
 * sideways at any width, and nothing becomes unreachable at a narrow one.
 */
const FIXTURES = join(process.cwd(), 'fixtures');

const WIDTHS = [
  { name: 'phone-360', width: 360, height: 740, narrow: true },
  { name: 'phone-390', width: 390, height: 844, narrow: true },
  { name: 'tablet-768', width: 768, height: 1024, narrow: true },
  { name: 'tablet-1024', width: 1024, height: 768, narrow: false },
  { name: 'desktop-1440', width: 1440, height: 900, narrow: false },
];

async function openFixture(page: Page, fixture: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, fixture));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });
}

/** How far the document overflows its own viewport, which must always be nil. */
async function sideways(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

for (const size of WIDTHS) {
  test(`the editor fits at ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    // Force the fallback file input, as the other specs do.
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    });

    await page.goto('/');
    await waitForLanding(page);
    expect(await sideways(page), 'landing scrolls sideways').toBe(0);

    await openFixture(page, 'multipage.pdf');

    const pane = await page.evaluate(() =>
      Math.round(document.querySelector('main')!.getBoundingClientRect().width),
    );
    expect(await sideways(page), 'editor scrolls sideways').toBe(0);

    // The whole point: the page is on the screen, not beside it. Two fixed
    // rails used to leave nothing here at all.
    expect(pane, 'document pane width').toBeGreaterThan(size.width * 0.4);
    await expect(page.locator('canvas[aria-label="Page 1"]')).toBeInViewport();

    const tools = page.getByRole('complementary', { name: 'Actions' });
    const pages = page.getByRole('complementary', { name: 'Pages' });

    if (size.narrow) {
      // Closed to start with, and each one opens and closes from the toolbar
      // button that has always opened and closed it.
      await expect(tools).toHaveCount(0);
      await expect(pages).toHaveCount(0);

      await page.getByRole('button', { name: /actions rail/i }).click();
      await expect(tools).toBeVisible();
      expect(await sideways(page), 'tools drawer scrolls the page sideways').toBe(0);

      // Opening the other rail replaces the first rather than stacking on it.
      await page.getByRole('button', { name: /pages rail/i }).click();
      await expect(tools).toHaveCount(0);
      await expect(pages).toBeVisible();

      // The scrim closes it too. Its own centre is under the drawer, so this
      // taps the exposed side, which is where a thumb would land.
      await page
        .getByRole('button', { name: /close this panel/i })
        .click({ position: { x: 20, y: 300 } });
      await expect(pages).toHaveCount(0);
    } else {
      // Unchanged on a wide screen: both rails in the flow, side by side.
      await expect(tools).toBeVisible();
      await expect(pages).toBeVisible();
      await expect(page.getByRole('button', { name: /close this panel/i })).toHaveCount(0);
    }
  });
}

test('the dialogs fit on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
  await page.goto('/');
  await waitForLanding(page);
  await openFixture(page, 'multipage.pdf');

  await page.getByRole('button', { name: /help/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await sideways(page), 'shortcuts dialog scrolls the page sideways').toBe(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /actions rail/i }).click();
  await page.getByRole('button', { name: /draw, type or upload/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await sideways(page), 'signature dialog scrolls the page sideways').toBe(0);

  // The drawing surface has to stay inside the screen, or you sign off-canvas.
  const canvas = page.getByRole('dialog').locator('canvas').first();
  if (await canvas.count()) {
    const box = (await canvas.boundingBox())!;
    expect(box.x, 'signature canvas starts off-screen').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'signature canvas ends off-screen').toBeLessThanOrEqual(360);
  }
});
