import {
  AUTHOR,
  CONTENT_PUBLISHED,
  CONTENT_UPDATED,
  DESCRIPTION,
  FAQ,
  FEATURES,
  REPO_URL,
  SECTIONS,
  SITE_NAME,
  SITE_URL,
  STEPS,
  TITLE,
} from './site';

/**
 * A section's visible heading, by `id`.
 *
 * The nodes below borrow the headings the page actually renders rather than
 * inventing names for themselves, because a `HowTo` called something that
 * appears nowhere on the page is exactly the mismatch this file exists to
 * avoid.
 */
function heading(id: string): string {
  return SECTIONS.find((section) => section.id === id)?.heading ?? SITE_NAME;
}

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
        // The page itself, as distinct from the site and from the product.
        // It carries the dates — a consumer deciding whether a description is
        // current looks for `dateModified`, and its absence reads as unknown
        // rather than as unchanged — and it names the two elements worth
        // reading aloud or lifting whole: the headline, and the paragraph
        // under it that defines what this is.
        '@type': 'WebPage',
        '@id': `${SITE_URL}/#webpage`,
        url: site,
        name: TITLE,
        description: DESCRIPTION,
        isPartOf: { '@id': `${SITE_URL}/#website` },
        about: { '@id': app },
        primaryImageOfPage: image,
        inLanguage: 'en',
        datePublished: CONTENT_PUBLISHED,
        dateModified: CONTENT_UPDATED,
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['h1', '#answer'],
        },
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
        // The same three steps the page shows under "How Paperweight works".
        // Google retired the HowTo rich result, so this earns nothing in a
        // search listing; it is here because a procedure stated as a
        // procedure is what an answer engine reproduces in order, rather than
        // paraphrasing into a shape that puts saving before editing.
        '@type': 'HowTo',
        '@id': `${SITE_URL}/#howto`,
        name: heading('how-it-works'),
        description: DESCRIPTION,
        inLanguage: 'en',
        tool: { '@type': 'HowToTool', name: 'A current web browser' },
        supply: { '@type': 'HowToSupply', name: 'A PDF on your device' },
        totalTime: 'PT1M',
        step: STEPS.map((step, index) => ({
          '@type': 'HowToStep',
          position: index + 1,
          name: step.title,
          text: step.text,
          url: `${SITE_URL}/#how-it-works`,
        })),
      },
      {
        // The feature grid as a list. `featureList` above is a bag of
        // strings; this is the same eleven items with positions, which is the
        // form a "what can it do" answer is assembled from.
        '@type': 'ItemList',
        '@id': `${SITE_URL}/#features`,
        name: heading('what-it-does'),
        numberOfItems: FEATURES.length,
        itemListOrder: 'https://schema.org/ItemListUnordered',
        itemListElement: FEATURES.map((feature, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: feature.label,
          description: feature.text,
        })),
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
