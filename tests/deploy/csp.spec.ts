import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForLanding } from '../e2e/helpers';

/**
 * The headers the deployment ships with, and that the app still works under
 * them.
 *
 * These run only against `wrangler dev` (`pnpm test:e2e:deploy`), because a
 * plain static server sends no headers at all. The rest of the suite runs
 * against the same server in that configuration, so any flow the policy
 * breaks fails there. What this file adds is the direct evidence: the headers
 * are present on the page, on the worker scripts and on the 404 page; the
 * policy has the strict shape the security review asked for; every inline
 * script actually served is one the policy allows; and each permission the
 * app relies on — WebAssembly, a blob: frame for printing, data: and blob:
 * images for signatures, FontFace from /fonts/ — is granted, with nothing
 * reported blocked.
 */

const FIXTURES = join(process.cwd(), 'fixtures');

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/** Parse a policy into directive → sources. */
function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...sources] = d.split(/\s+/);
        return [name, sources];
      }),
  );
}

/**
 * Watch a page for console errors and for the browser's own violation
 * reports, which name the directive and what it blocked. The native file
 * pickers are removed as the other specs do, so the fallback input opens
 * files.
 */
async function watch(page: Page): Promise<() => Promise<string[]>> {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__cspViolations.push(
        `${e.violatedDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`,
      );
    });
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });

  return async () => [
    ...errors.filter((e) => !/favicon/i.test(e)),
    ...(await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    )),
  ];
}

test('the page, the worker scripts and the 404 page carry the headers', async ({ request }) => {
  for (const path of ['/', '/engine-worker.js', '/tesseract/worker.min.js', '/no-such-page']) {
    const headers = (await request.get(path)).headers();
    expect(headers['content-security-policy'], `${path} has a policy`).toBeTruthy();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headers[name], `${path} ${name}`).toBe(value);
    }
  }
  // An unknown path is a real 404, not the app pretending the page exists.
  expect((await request.get('/no-such-page')).status()).toBe(404);
});

test('the policy is the strict one', async ({ request }) => {
  const csp = (await request.get('/')).headers()['content-security-policy'];
  const policy = directives(csp);

  expect(policy.get('default-src')).toEqual(["'self'"]);
  expect(policy.get('object-src')).toEqual(["'none'"]);
  expect(policy.get('base-uri')).toEqual(["'none'"]);
  expect(policy.get('form-action')).toEqual(["'none'"]);
  expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
  expect(policy.get('connect-src')).toEqual(["'self'"]);
  expect(policy.get('worker-src')).toEqual(["'self'"]);

  const script = policy.get('script-src') ?? [];
  expect(script).toContain("'self'");
  expect(script).toContain("'wasm-unsafe-eval'");
  expect(script).not.toContain("'unsafe-inline'");
  expect(script).not.toContain("'unsafe-eval'");
  expect(script.filter((s) => s.startsWith("'sha256-")).length).toBeGreaterThan(0);

  // No directive names another origin. A host has a dot or a scheme with
  // slashes; the allowed sources are keywords, hashes and bare schemes.
  for (const [name, sources] of policy) {
    for (const source of sources) {
      expect(source, `${name} allows ${source}`).not.toMatch(/\.|\/\/|^\*/);
    }
  }
});

test('every inline script served is allowed by hash', async ({ request }) => {
  for (const path of ['/', '/no-such-page']) {
    const response = await request.get(path);
    const csp = response.headers()['content-security-policy'];
    const html = await response.text();

    let inline = 0;
    for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/i.test(attrs) || body.length === 0) continue;
      inline++;
      const hash = createHash('sha256').update(body, 'utf8').digest('base64');
      expect(csp, `${path}: ${body.slice(0, 60)}…`).toContain(`'sha256-${hash}'`);
    }
    expect(inline, `${path} has inline scripts to check`).toBeGreaterThan(0);
  }
});

test('the app runs under the policy with nothing blocked', async ({ page }) => {
  const report = await watch(page);
  await page.goto('/');
  await waitForLanding(page);

  // The engine: a same-origin module worker, a fetched WASM binary and its
  // compilation. A rendered page means all three were allowed.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, 'simple-text.pdf'));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });

  // The permissions other flows need, exercised directly so this test does not
  // depend on the signature modal or on a print dialog.
  const probes = await page.evaluate(async () => {
    const image = (src: string) =>
      new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => resolve('loaded');
        img.onerror = () => resolve('blocked');
        img.src = src;
      });

    // img-src data: — a signature preview.
    const onePixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const dataImage = await image(onePixel);

    // img-src blob: — an uploaded signature photo.
    const blobImage = await new Promise<string>((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      canvas.toBlob((blob) => {
        if (!blob) return resolve('no blob');
        image(URL.createObjectURL(blob)).then(resolve);
      });
    });

    // font-src — a signature face, loaded the way SignatureModal does.
    const font = await new FontFace('CspProbe', 'url(/fonts/Caveat-Variable.ttf)')
      .load()
      .then(
        () => 'loaded',
        (error: unknown) => `blocked: ${String(error)}`,
      );

    // frame-src blob: — the print frame. A blocked frame still fires `load`,
    // so the verdict for this one is the violation report checked below.
    await new Promise<void>((resolve) => {
      const frame = document.createElement('iframe');
      frame.hidden = true;
      frame.onload = () => resolve();
      frame.src = URL.createObjectURL(
        new Blob(['<!doctype html><title>print probe</title>'], { type: 'text/html' }),
      );
      document.body.append(frame);
      setTimeout(resolve, 5_000);
    });

    return { dataImage, blobImage, font };
  });

  expect(probes).toEqual({ dataImage: 'loaded', blobImage: 'loaded', font: 'loaded' });
  expect(await report()).toEqual([]);
});
