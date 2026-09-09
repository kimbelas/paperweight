import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * Printing, which was the one core flow with no test of its own.
 *
 * That gap had already cost something. `frame-ancestors 'none'` in the shipped
 * Content-Security-Policy refused the print frame under WebKit — a blob: frame
 * inherits the creating document's policy, and WebKit enforces the inherited
 * directive against the parent — so on Safari the app's own headers blocked
 * printing. The only thing that noticed was a synthetic blob: frame in the CSP
 * spec, which reported a violation rather than a broken feature, and only once
 * the suite began running in an engine that reports one.
 *
 * What matters about printing is *which path* it took. The real bytes go to
 * the browser's own PDF viewer in an off-screen frame, so vectors stay vectors
 * and embedded fonts stay fonts. When that frame cannot be driven, `print.ts`
 * opens the document in a tab and tells the user to press the shortcut: it
 * works, but it is a worse experience and nothing about the app's appearance
 * says it happened. A silent downgrade to the fallback is the regression this
 * file exists to catch — and under `pnpm test:e2e:deploy`, where the real
 * headers are served, it is also the guard on that directive, because a
 * refused frame is exactly what causes the downgrade.
 *
 * # Why this test waits
 *
 * None of the obvious signals distinguishes success from refusal.
 *
 *  - A refused frame is still an element with a `src`, and still fires `load`.
 *  - `contentDocument.readyState` is `complete` either way.
 *  - `contentDocument.URL` is `about:blank` either way and in every engine,
 *    because the frame hosts the browser's PDF plugin rather than a document.
 *
 * An earlier version of this test asserted all three and passed against the
 * bug, which is worse than having no test. What actually separates the two is
 * *persistence*: `printViaIframe` keeps a working frame alive long after the
 * dialog is requested — a preview torn down early prints blank in Firefox —
 * whereas a frame it gives up on is removed, and only then does the fallback
 * open a tab. Giving up takes `LOAD_TIMEOUT_MS`, 12 seconds, so the outcome is
 * not settled before then and there is no event to wait for in the good case.
 * Waiting out the deadline is the only honest way to assert that a timeout did
 * not fire.
 */
const FIXTURES = join(process.cwd(), 'fixtures');

/**
 * Longer than `LOAD_TIMEOUT_MS` in `src/io/print.ts`, which is when the iframe
 * path gives up, removes the frame and falls back to a tab.
 */
const PAST_THE_DEADLINE_MS = 14_000;

/** The fallback's own notice, matched as a user would read it. */
const FALLBACK_NOTICE = /opened in a new tab/i;

test('printing goes through the frame rather than the fallback', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });

  // A tab is the fallback's doing. Collected rather than asserted on the spot,
  // so a failure can say where printing actually went.
  const popups: string[] = [];
  page.on('popup', (popup) => popups.push(popup.url()));

  await page.goto('/');
  await waitForLanding(page);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, 'simple-text.pdf'));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole('button', { name: 'Print' }).click();

  // The document is handed to a frame at all, rather than the flow failing
  // before one exists.
  const frame = page.locator('iframe[title="Print preview"]');
  await expect(frame, 'no print frame was created').toHaveCount(1);
  await expect(frame).toHaveAttribute('src', /^blob:/);

  await page.waitForTimeout(PAST_THE_DEADLINE_MS);

  // Still here. A frame the print path gave up on has been removed by now, so
  // this is the assertion that the browser accepted it — under the deployed
  // headers, that the policy did.
  await expect(frame, 'the print frame was withdrawn, so printing fell back').toHaveCount(1);

  // And no downgrade by either of its visible signs.
  await expect(page.getByText(FALLBACK_NOTICE)).toHaveCount(0);
  await expect(page.getByText(/could not be printed/i)).toHaveCount(0);
  expect(popups, 'printing opened a tab, which is the fallback path').toEqual([]);
});
