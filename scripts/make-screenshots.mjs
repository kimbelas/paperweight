/**
 * Generate the README's screenshots.
 *
 * Run by hand with `pnpm shots` after `pnpm build`; the output is committed to
 * `docs/screenshots/`, for the same reason the brand images are — a README is
 * read on github.com and on npm and inside a language model's crawl, none of
 * which run a build step. An image that only exists after `pnpm test:e2e` is
 * an image nobody reading the project ever sees.
 *
 * It is a script rather than a Playwright test because it asserts nothing.
 * The e2e suite already screenshots the app, into `test-results/`, which is
 * gitignored and correctly so: those are diagnostics for a failing run. These
 * are documentation, and the difference is whether a stale one is a nuisance
 * or a lie. Regenerate them when the interface changes.
 *
 * Every document here is a fixture from `fixtures/`. Nothing in
 * `fixtures/local/` — real documents — may ever be screenshotted into a
 * committed file.
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(root, 'fixtures');
const OUT = join(root, 'docs', 'screenshots');

/** Not 4173: the e2e suite's server may be up, and this must not adopt it. */
const PORT = 4188;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * 1280x800 at 1x.
 *
 * Wide enough for the desktop layout — the section rail and the properties
 * panel both appear above 1280 — and small enough that six PNGs are about a
 * megabyte. A 2x capture doubles the weight of the repository to look the
 * same in a README that scales the image down anyway.
 */
const VIEWPORT = { width: 1280, height: 800 };

/** A PDF-space point on a 612x792 page, in the rendered canvas. */
async function clickPdf(page, pdfX, pdfY) {
  const box = await page.locator('canvas[aria-label="Page 1"]').boundingBox();
  await page.mouse.click(
    box.x + pdfX * (box.width / 612),
    box.y + (792 - pdfY) * (box.height / 792),
  );
}

async function openFixture(page, fixture) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, fixture));
  await page.locator('canvas[aria-label="Page 1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page
    .getByText('Rendering…')
    .waitFor({ state: 'detached', timeout: 60_000 })
    .catch(() => {});
  await page.waitForTimeout(500);
}

/** Back to a fresh editor, so one shot cannot inherit another's state. */
async function reload(page) {
  await page.goto(ORIGIN);
  await page.getByRole('button', { name: /choose a pdf/i }).waitFor({ state: 'visible' });
  // The prerendered landing has a disabled button; the mounted editor enables
  // it. Screenshotting between the two catches the page mid-hydration.
  await page
    .locator('button:not([disabled])')
    .filter({ hasText: /choose a pdf/i })
    .first()
    .waitFor({ timeout: 30_000 });
}

const shots = [];
async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  shots.push(name);
}

/** A plain static file server, which is all the built app needs. */
function serve() {
  const server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['serve', 'out', '--listen', String(PORT), '--no-clipboard', '--single'],
    { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  return server;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(ORIGIN);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no server at ${ORIGIN} — has \`pnpm build\` been run?`);
}

const server = serve();
let browser;

try {
  await waitForServer();

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });

  // Chromium has the File System Access API and the app prefers it, so
  // without this there is no file chooser to answer.
  await context.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });

  const page = await context.newPage();

  // 1. The landing page, which is also the editor's empty state.
  await reload(page);
  await shot(page, '01-landing');

  // 2. Editing a line of text that is already in the document — the one
  //    thing most "PDF editors" cannot do.
  await openFixture(page, 'flattened-signature.pdf');
  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, 120, 698);
  await page.waitForTimeout(500);
  await shot(page, '02-edit-text');

  // 3. A filled form, with a field open. The values are drawn through the
  //    form-fill environment; a field is edited through the form itself.
  await reload(page);
  await openFixture(page, 'filled-form.pdf');
  await page.getByRole('button', { name: /edit text/i }).click();
  await clickPdf(page, 300, 665);
  await page.waitForTimeout(500);
  await shot(page, '03-fill-form');

  // 4. Adding a signature by typing it in a script face.
  await reload(page);
  await openFixture(page, 'simple-text.pdf');
  await page.getByRole('button', { name: /^signature$/i }).click();
  const dialog = page.getByRole('dialog', { name: /add a signature/i });
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'type', exact: true }).click();
  await dialog.getByRole('textbox', { name: /name to render/i }).fill('Jane Doe');
  await page.waitForTimeout(900);
  await shot(page, '04-add-signature');

  // 5. Reading a scan. The panel reports a confidence per line and says in
  //    the interface that replacing one is a patch rather than an edit.
  await reload(page);
  await openFixture(page, 'scanned-text.pdf');
  await page.getByRole('button', { name: /read this page/i }).click();
  await page.getByText(/Found\s+\d+\s+lines?/i).waitFor({ state: 'visible', timeout: 240_000 });
  await page.waitForTimeout(500);
  await shot(page, '05-read-a-scan');

  // 6. The dark theme. On a different document from the shot above it: two
  //    pictures of the same page differing only in colour is one picture.
  //
  //    Through the toggle rather than by emulating a dark system, because the
  //    app deliberately does not follow `prefers-color-scheme` — emulating
  //    one would file the light theme under a dark name.
  await reload(page);
  await openFixture(page, 'flattened-signature.pdf');
  await page.getByRole('button', { name: /switch to the dark theme/i }).click();
  await page.waitForTimeout(700);
  await shot(page, '06-dark-theme');

  const written = await readdir(OUT);
  console.log(`screenshots → docs/screenshots/ (${written.length})`);
  for (const name of shots) console.log(`  ${name}.png`);
} finally {
  await browser?.close();
  server.kill();
}
