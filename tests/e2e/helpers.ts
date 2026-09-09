import { expect, type Page } from '@playwright/test';

/**
 * Wait until the editor has actually mounted and can open a file.
 *
 * Every spec used to wait on the landing heading, which worked because the
 * heading only existed once the client bundle had run. That is no longer true:
 * the landing is prerendered into the static HTML so crawlers can read it, so
 * the heading is visible before a single line of application JavaScript has
 * executed. Waiting on it now would let a test click "Choose a PDF" against
 * the inert copy and time out somewhere far less obvious.
 *
 * The button is the signal instead. The prerendered one is `disabled` — a real
 * attribute, not a style — and only the mounted editor supplies the handler
 * that enables it. Waiting for it to be enabled means what waiting for the
 * heading used to mean.
 */
export async function waitForLanding(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /choose a pdf/i })).toBeEnabled();
}
