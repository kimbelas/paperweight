import { expect, test } from '@playwright/test';
import {
  ANSWER,
  ARCHITECTURE,
  ARCHITECTURE_HINT,
  CONTENT_UPDATED,
  DESCRIPTION,
  FAQ,
  FEATURES,
  HEADLINE,
  LIMITS,
  NAV_LABEL,
  REPO_URL,
  SECTIONS,
  SITE_NAME,
  SITE_URL,
  STEPS,
  TITLE,
  TRUST,
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

    // The paragraph under the headline is the one an answer engine lifts
    // whole, so it has to be there, complete, before a script has run.
    await expect(page.locator('#answer')).toHaveText(ANSWER);

    // Every claim above the fold arrives with the thing that backs it up. A
    // claim quoted without its evidence is how a summarised page turns into
    // marketing.
    for (const claim of TRUST) {
      await expect(page.getByText(claim.label, { exact: true })).toHaveCount(1);
      await expect(page.getByText(claim.detail, { exact: true })).toHaveCount(1);
    }

    // Headings name the product, and each section is anchored, so a passage
    // can be cited by fragment rather than as "somewhere on the homepage".
    expect(await page.locator('h2').allTextContents()).toEqual(
      SECTIONS.map((section) => section.heading),
    );

    const nav = page.getByRole('navigation', { name: NAV_LABEL });
    for (const section of SECTIONS) {
      await expect(page.locator(`section#${section.id}`)).toHaveCount(1);
      await expect(nav.getByRole('link', { name: section.nav, exact: true })).toHaveAttribute(
        'href',
        `#${section.id}`,
      );
    }

    // Every `h3` belongs to a section, and each section's set is exactly what
    // `site.ts` says it is. Asserting a bare count would pass again the day
    // the feature grid and the FAQ swap headings.
    expect(await page.locator('#what-it-does h3').allTextContents()).toEqual(
      FEATURES.map((feature) => feature.label),
    );
    expect(await page.locator('#how-it-works h3').allTextContents()).toEqual(
      STEPS.map((step) => step.title),
    );
    expect(await page.locator('#questions h3').allTextContents()).toEqual(
      FAQ.map((entry) => entry.question),
    );

    for (const entry of FAQ) {
      await expect(page.getByText(entry.answer, { exact: true })).toHaveCount(1);
    }
    for (const limit of LIMITS) {
      await expect(page.getByText(limit, { exact: true })).toHaveCount(1);
    }

    // The comparison is a real table. It is the one block on the page a
    // summariser is most likely to reproduce verbatim, and a table only
    // survives that if it is marked up as one.
    const comparison = page.locator('#privacy table');
    await expect(comparison).toHaveCount(1);
    for (const row of ARCHITECTURE) {
      await expect(comparison.getByRole('rowheader', { name: row.aspect })).toHaveCount(1);
    }

    // A description with no date reads as undated, not as unchanged.
    await expect(page.locator(`time[datetime="${CONTENT_UPDATED}"]`)).toHaveCount(1);

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
        'WebPage',
        'Person',
        'SoftwareApplication',
        'SoftwareSourceCode',
        'HowTo',
        'ItemList',
        'FAQPage',
      ]),
    );

    const node = (type: string) =>
      graph['@graph'].find((entry) =>
        Array.isArray(entry['@type']) ? entry['@type'].includes(type) : entry['@type'] === type,
      );

    // The dates, and the two elements worth reading aloud. The selectors have
    // to resolve on the page above, or they describe a page that is not this
    // one.
    const webPage = node('WebPage') as unknown as {
      dateModified: string;
      speakable: { cssSelector: string[] };
    };
    expect(webPage.dateModified).toBe(CONTENT_UPDATED);
    for (const selector of webPage.speakable.cssSelector) {
      await expect(page.locator(selector)).toHaveCount(1);
    }

    // A procedure stated as a procedure, in the page's own order and words.
    const howTo = node('HowTo') as unknown as {
      name: string;
      step: { name: string; text: string }[];
    };
    expect(howTo.name).toBe(SECTIONS.find((section) => section.id === 'how-it-works')!.heading);
    expect(howTo.step.map((step) => step.name)).toEqual(STEPS.map((step) => step.title));
    expect(howTo.step.map((step) => step.text)).toEqual(STEPS.map((step) => step.text));

    const list = node('ItemList') as unknown as { itemListElement: { name: string }[] };
    expect(list.itemListElement.map((item) => item.name)).toEqual(
      FEATURES.map((feature) => feature.label),
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
  await expect(page.locator('#answer')).toHaveText(ANSWER);
  await expect(page.locator('h2')).toHaveCount(SECTIONS.length);
  await expect(page.locator('#questions h3')).toHaveCount(FAQ.length);
  await expect(page.locator('#what-it-does h3')).toHaveCount(FEATURES.length);
  await expect(page.locator('#privacy table')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /source on github/i })).toHaveAttribute(
    'href',
    REPO_URL,
  );

  // Adding a page's worth of copy must not have added a page's worth of
  // requests to somebody else's server.
  expect(offSite, `off-site requests: ${offSite.join(', ')}`).toEqual([]);
});

test('the landing page never scrolls sideways', async ({ page }) => {
  // The landing is a column of grids and one deliberately wide table, laid
  // out inside the editor's own scroll pane rather than the document. A
  // sideways scrollbar there is the classic way a card grid or a table breaks
  // a phone, and it is invisible at desktop width — which is where every
  // other test in this suite runs.
  for (const width of [360, 390, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await waitForLanding(page);

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const pane = document.querySelector('main')!;
      return {
        document: root.scrollWidth - root.clientWidth,
        pane: pane.scrollWidth - pane.clientWidth,
      };
    });

    expect(overflow.document, `document overflows at ${width}px`).toBe(0);
    expect(overflow.pane, `landing pane overflows at ${width}px`).toBe(0);

    // The comparison table is the one thing allowed to be wider than the
    // screen, and only because it scrolls inside its own box. On a narrow
    // screen the reader has to be told, or the second column simply is not
    // there as far as they know.
    const scroller = page.locator('#privacy table').locator('xpath=..');
    const table = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
    if (table > 0) {
      await expect(page.getByText(ARCHITECTURE_HINT, { exact: true })).toBeVisible();
    }
  }
});

test('the heading levels are told apart by eye, not only by tag', async ({ page }) => {
  // The levels were correct long before they were legible: one h1, five h2,
  // twenty-five h3, properly nested and asserted above — and set at 54px,
  // 16px and 14px. A two-pixel step between a section heading and the entries
  // under it is a hierarchy a parser can see and a reader cannot, which is
  // half of the job at best. These ratios are what keep the two in step.
  await page.goto('/');
  await waitForLanding(page);

  const size = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  const [h1, h2, h3, body] = await Promise.all([
    size('h1'),
    size('h2'),
    size('#what-it-does h3'),
    size('#answer'),
  ]);

  expect(h1, `h1 ${h1} vs h2 ${h2}`).toBeGreaterThan(h2 * 1.5);
  expect(h2, `h2 ${h2} vs h3 ${h3}`).toBeGreaterThan(h3 * 1.4);
  expect(h3, `h3 ${h3} vs body ${body}`).toBeLessThanOrEqual(body);

  // And the same holds on a phone, where the h1 shrinks but the entries do not.
  await page.setViewportSize({ width: 390, height: 844 });
  const [mh1, mh2, mh3] = await Promise.all([size('h1'), size('h2'), size('#what-it-does h3')]);
  expect(mh1, `phone h1 ${mh1} vs h2 ${mh2}`).toBeGreaterThan(mh2 * 1.4);
  expect(mh2, `phone h2 ${mh2} vs h3 ${mh3}`).toBeGreaterThan(mh3 * 1.25);
});
