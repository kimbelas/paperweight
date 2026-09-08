import { expect, test, type Page } from '@playwright/test';

/**
 * Light by default, dark on request, remembered.
 *
 * The first test is the one with a bug behind it: the app followed
 * `prefers-color-scheme`, so a machine set to dark opened a white PDF page
 * inside a dark frame. It emulates a dark system precisely because that is the
 * case that used to get it wrong.
 *
 * The last test is about the flash. A theme restored after the first paint is
 * a theme the user watches change, so the stored choice has to be on the
 * document before anything is drawn — which means asserting it is already
 * right at `domcontentloaded`, not merely right once React has hydrated.
 */

async function themeOf(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test('opens light even when the system asks for dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /open a pdf to edit/i })).toBeVisible();

  expect(await themeOf(page)).toBe('light');
  expect(await bodyBackground(page)).toBe('rgb(244, 244, 245)');
});

test('the toggle switches to dark and back', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /open a pdf to edit/i })).toBeVisible();

  await page.getByRole('button', { name: /switch to the dark theme/i }).click();
  expect(await themeOf(page)).toBe('dark');
  expect(await bodyBackground(page)).toBe('rgb(24, 24, 27)');

  // The button now offers the way back, rather than reporting where you are.
  await page.getByRole('button', { name: /switch to the light theme/i }).click();
  expect(await themeOf(page)).toBe('light');
  expect(await bodyBackground(page)).toBe('rgb(244, 244, 245)');
});

test('the choice survives a reload, with no flash of the wrong theme', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /open a pdf to edit/i })).toBeVisible();
  await page.getByRole('button', { name: /switch to the dark theme/i }).click();
  expect(await themeOf(page)).toBe('dark');

  // `domcontentloaded`, not `load`: the theme has to be stamped by the
  // blocking boot script rather than by anything React does later.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(await themeOf(page)).toBe('dark');

  await expect(page.getByRole('button', { name: /switch to the light theme/i })).toBeVisible();
});
