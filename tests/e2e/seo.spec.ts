import { expect, test } from '@playwright/test';
import {
  DESCRIPTION,
  FAQ,
  HEADLINE,
  LIMITS,
  REPO_URL,
  SITE_NAME,
  SITE_URL,
  TITLE,
} from '../../src/site';
import { waitForLanding } from './helpers';

/**
 * What the outside world receives.
 *
 * The editor cannot be server-rendered, so for most of this app's life the
 * static HTML was the words "Starting the editor…" and nothing else. Every
 * crawler, link preview and language model that fetched the site got a blank
 * page, and there was no test that could tell — the browser suite runs
 * JavaScript, so it never saw what a scraper sees.
 *
 * The first test here therefore runs with JavaScript switched off, which is
 * the only honest way to check this. The second fetches the files a search
 * engine, a phone launcher and an installer look for. The third makes sure
 * the copy is still in the DOM after the editor mounts, because content that
 * appears in the source and then disappears counts for nothing.
 *
 * Note what is *not* asserted by status code alone. The static file server
 * these tests run against is started with `--single`, so it answers any
 * unknown path with `index.html` and a cheerful 200. Every file assertion
 * below checks the content type and the body.
 */

test('the page a crawler receives describes the app', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  try {
    await page.goto('/');

    // --- The head -------------------------------------------------------

    await expect(page).toHaveTitle(TITLE);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', DESCRIPTION);
    // Next normalises the root path away, so the canonical is the bare
    // origin. Both forms name the same document; pin either.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`^${SITE_URL}/?$`),
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /index/);
    await expect(page.locator('meta[name="keywords"]')).toHaveAttribute('content', /PDF/i);

    // The share card. `og:image` is absolute and points at production even
    // from a local build, which is the point of `metadataBase`: a preview
    // deployment must not advertise itself as the canonical site.
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', TITLE);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      new RegExp(`^${SITE_URL}/?$`),
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      /\/opengraph-image\.png/,
    );
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    );
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
      'content',
      /\/opengraph-image\.png/,
    );

    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

    // --- The body -------------------------------------------------------

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText(HEADLINE);

    // The button exists but cannot be pressed, because nothing has mounted to
    // handle it. `waitForLanding` depends on exactly this.
    await expect(page.getByRole('button', { name: /choose a pdf/i })).toBeDisabled();

    const sections = await page.locator('h2').allTextContents();
    expect(sections).toEqual([
      'What it does',
      'How it works',
      'Questions',
      'Privacy',
      'Deliberate limits',
    ]);

    expect(await page.locator('h3').allTextContents()).toEqual(FAQ.map((entry) => entry.question));
    for (const entry of FAQ) {
      await expect(page.getByText(entry.answer, { exact: true })).toHaveCount(1);
    }
    for (const limit of LIMITS) {
      await expect(page.getByText(limit, { exact: true })).toHaveCount(1);
    }

    // The honesty rules the interface keeps must survive into the copy a
    // search engine quotes, or the summary of this app becomes a lie by
    // omission on somebody else's page.
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).toContain('this is not redaction');
    expect(body).toContain('never matches the original typeface');
    expect(body).toContain('invalidates the signature');

    // --- The structured data ---------------------------------------------

    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks).toHaveLength(1);

    const graph = JSON.parse(blocks[0]) as {
      '@graph': { '@type': string | string[]; [key: string]: unknown }[];
    };
    const types = graph['@graph'].flatMap((node) =>
      Array.isArray(node['@type']) ? node['@type'] : [node['@type']],
    );
    expect(types).toEqual(
      expect.arrayContaining([
        'WebSite',
        'Person',
        'SoftwareApplication',
        'SoftwareSourceCode',
        'FAQPage',
      ]),
    );

    // Structured data that contradicts the visible page is worse than none.
    const faqNode = graph['@graph'].find((node) => node['@type'] === 'FAQPage') as unknown as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(faqNode.mainEntity.map((q) => q.name)).toEqual(FAQ.map((entry) => entry.question));
    expect(faqNode.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(
      FAQ.map((entry) => entry.answer),
    );

    const app = graph['@graph'].find(
      (node) => Array.isArray(node['@type']) && node['@type'].includes('SoftwareApplication'),
    ) as unknown as { offers: { price: string }; isAccessibleForFree: boolean; sameAs: string[] };
    expect(app.offers.price).toBe('0');
    expect(app.isAccessibleForFree).toBe(true);
    expect(app.sameAs).toContain(REPO_URL);
  } finally {
    await context.close();
  }
});

test('serves the files search engines and installers look for', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.headers()['content-type']).toContain('text/plain');
  const robotsBody = await robots.text();
  expect(robotsBody).toContain('User-Agent: *');
  expect(robotsBody).toContain('Allow: /');
  expect(robotsBody).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  expect(robotsBody).toContain('Content-Signal: search=yes, ai-input=yes');
  // Nothing is blocked, deliberately: an answer engine that cannot read the
  // page describes it from someone else's guess instead.
  expect(robotsBody).not.toContain('Disallow');

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.headers()['content-type']).toMatch(/xml/);
  expect(await sitemap.text()).toContain(`<loc>${SITE_URL}/</loc>`);

  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.headers()['content-type']).toMatch(/manifest\+json|application\/json/);
  const parsed = JSON.parse(await manifest.text()) as {
    name: string;
    display: string;
    icons: { src: string }[];
  };
  expect(parsed.name).toContain(SITE_NAME);
  expect(parsed.display).toBe('standalone');
  expect(parsed.icons.length).toBeGreaterThan(0);

  // The share image must be served as an image. Generating it from code would
  // have produced an extension-less file typed `application/octet-stream`,
  // which every scraper refuses and no build step complains about, so this
  // assertion is the whole reason the PNGs are committed rather than built.
  for (const path of ['/opengraph-image.png', '/apple-icon.png', '/icons/icon-192.png']) {
    const image = await request.get(path);
    expect(image.headers()['content-type'], `${path} content type`).toBe('image/png');
    expect((await image.body()).length, `${path} size`).toBeGreaterThan(1000);
  }

  const icon = await request.get('/icon.svg');
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
  expect(await icon.text()).toContain('<svg');

  const llms = await request.get('/llms.txt');
  expect(llms.headers()['content-type']).toContain('text/plain');
  const llmsBody = await llms.text();
  expect(llmsBody).toContain(SITE_NAME);
  expect(llmsBody).toContain(SITE_URL);
  expect(llmsBody).toContain('Cover is not redaction');
});

test('the landing copy is still there once the editor mounts', async ({ page, baseURL }) => {
  // Same origin is whatever server this run is against: the static server in
  // the base config, or wrangler dev in the deploy one.
  const origin = new URL(baseURL!).origin;
  const offSite: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      offSite.push(url);
    }
  });

  await page.goto('/');
  await waitForLanding(page);

  // Google indexes the rendered DOM. If the prerendered copy were replaced by
  // a bare drop zone when the editor took over, all of the above would be
  // worth nothing.
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText(HEADLINE);
  await expect(page.locator('h2')).toHaveCount(5);
  await expect(page.locator('h3')).toHaveCount(FAQ.length);
  await expect(page.getByRole('link', { name: /source on github/i })).toHaveAttribute(
    'href',
    REPO_URL,
  );

  // Adding a page's worth of copy must not have added a page's worth of
  // requests to somebody else's server.
  expect(offSite, `off-site requests: ${offSite.join(', ')}`).toEqual([]);
});
