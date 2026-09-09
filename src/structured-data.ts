import {
  AUTHOR,
  DESCRIPTION,
  FAQ,
  FEATURES,
  REPO_URL,
  SITE_NAME,
  SITE_URL,
} from './site';

/**
 * Schema.org description of the site, for search and answer engines.
 *
 * One `@graph` rather than several `<script>` blocks, so the nodes can point
 * at each other by `@id` — the author is stated once and referenced three
 * times, which is what tells a consumer they are the same person rather than
 * three people who share a name.
 *
 * Everything here restates `site.ts`; nothing is written twice. The FAQ in
 * particular is generated from the same array the page renders, and a test
 * compares the two, because structured data that contradicts the visible page
 * is worse than none: it is the one thing a search engine will penalise.
 *
 * There is deliberately no `license`. The repository has no LICENCE file yet,
 * and claiming a licence in metadata that the source does not grant would be
 * a false statement about someone else's rights.
 */
export function structuredData(): Record<string, unknown> {
  const site = `${SITE_URL}/`;
  const author = `${SITE_URL}/#author`;
  const app = `${SITE_URL}/#app`;
  const image = `${SITE_URL}/opengraph-image.png`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: site,
        name: SITE_NAME,
        description: DESCRIPTION,
        inLanguage: 'en',
        publisher: { '@id': author },
      },
      {
        '@type': 'Person',
        '@id': author,
        name: AUTHOR.name,
        url: AUTHOR.url,
      },
      {
        '@type': ['SoftwareApplication', 'WebApplication'],
        '@id': app,
        name: SITE_NAME,
        url: site,
        description: DESCRIPTION,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'PDF editor',
        operatingSystem: 'Any (web browser)',
        browserRequirements: 'Requires JavaScript, WebAssembly and Web Workers',
        isAccessibleForFree: true,
        // Stating a price of zero is what marks it free to a consumer that
        // reads offers rather than prose. Omitting the offer reads as
        // "price unknown".
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: FEATURES.map((feature) => `${feature.label}: ${feature.text}`),
        image,
        screenshot: image,
        inLanguage: 'en',
        author: { '@id': author },
        sameAs: [REPO_URL],
      },
      {
        // `codeRepository` belongs to the source, not to the application, so
        // the source is its own node pointing back at the product.
        '@type': 'SoftwareSourceCode',
        '@id': `${SITE_URL}/#source`,
        name: `${SITE_NAME} source`,
        codeRepository: REPO_URL,
        programmingLanguage: 'TypeScript',
        runtimePlatform: 'Web browser',
        targetProduct: { '@id': app },
        author: { '@id': author },
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}/#faq`,
        mainEntity: FAQ.map((entry) => ({
          '@type': 'Question',
          name: entry.question,
          acceptedAnswer: { '@type': 'Answer', text: entry.answer },
        })),
      },
    ],
  };
}

/**
 * The graph as the exact bytes to put inside a `<script>` element.
 *
 * `<` is escaped to `<`, which is still valid JSON and still parses to
 * the same string, but makes it impossible for any value to close the script
 * element early. That matters twice over here: an HTML injection would be the
 * obvious problem, and the less obvious one is that `scripts/write-headers.mjs`
 * finds inline scripts with a non-greedy regex and hashes what it finds for
 * the Content-Security-Policy. A stray `</script>` inside the JSON would make
 * it hash a truncated body, the hash would not match what the browser
 * received, and the block would be refused with no error anyone would see.
 */
export function structuredDataJson(): string {
  return JSON.stringify(structuredData()).replace(/</g, '\\u003c');
}
