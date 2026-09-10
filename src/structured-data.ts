import {
  AUTHOR,
  CONTENT_PUBLISHED,
  CONTENT_UPDATED,
  DESCRIPTION,
  FAQ,
  FEATURES,
  REPO_URL,
  SCREENSHOTS,
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
/** SPDX's canonical URI for the licence in `LICENSE`. */
const MIT_LICENCE = 'https://spdx.org/licenses/MIT.html';

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
 * Every node hangs off the page. Four of them used to float free — the FAQ,
 * the procedure, the feature list and the source — each a valid island that
 * nothing pointed at, so a consumer could read one and still not know it
 * described *this* URL. `hasPart`, `mainEntityOfPage` and `isPartOf` say so.
 *
 * What is deliberately absent is `aggregateRating`. Google requires it, or a
 * `review`, before a `SoftwareApplication` is eligible for a rich result, so
 * this node will not win one — and a rating a project awards itself is the
 * self-serving markup that earns a manual action. The node stays for entity
 * understanding, and the rich result is forgone until somebody else reviews
 * this.
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
        sameAs: [REPO_URL],
      },
      {
        // The page itself, as distinct from the site and from the product.
        // It carries the dates — a consumer deciding whether a description is
        // current looks for `dateModified`, and its absence reads as unknown
        // rather than as unchanged — and it names the two elements worth
        // reading aloud or lifting whole.
        //
        // Co-typed `FAQPage`, because the questions are on this page rather
        // than on a page of their own. As its own node the FAQ was an island:
        // valid, and attached to nothing that said which URL it described.
        // Google stopped showing FAQ rich results in May 2026, so this earns
        // no listing — Bing and the answer engines still read it, and it
        // costs nothing, being built from the array the page renders.
        //
        // No `speakable`: it is beta and limited to news publishers serving
        // US English. A property that cannot apply is a claim to be something
        // this is not.
        '@type': ['WebPage', 'FAQPage'],
        '@id': `${SITE_URL}/#webpage`,
        url: site,
        name: TITLE,
        description: DESCRIPTION,
        isPartOf: { '@id': `${SITE_URL}/#website` },
        about: { '@id': app },
        // `primaryImageOfPage` takes an `ImageObject`, not a URL — unlike
        // `image`, which takes either. A bare string here is a type error
        // that reads as "no primary image".
        primaryImageOfPage: {
          '@type': 'ImageObject',
          '@id': `${SITE_URL}/#ogimage`,
          url: image,
          contentUrl: image,
          width: 1200,
          height: 630,
        },
        hasPart: [{ '@id': `${SITE_URL}/#howto` }, { '@id': `${SITE_URL}/#features` }],
        mainEntity: FAQ.map((entry) => ({
          '@type': 'Question',
          name: entry.question,
          acceptedAnswer: { '@type': 'Answer', text: entry.answer },
        })),
        inLanguage: 'en',
        datePublished: CONTENT_PUBLISHED,
        dateModified: CONTENT_UPDATED,
      },
      {
        '@type': ['SoftwareApplication', 'WebApplication'],
        '@id': app,
        name: SITE_NAME,
        url: site,
        description: DESCRIPTION,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'PDF editor',
        // 'All' is the conventional value for something with no platform of
        // its own. `browserRequirements` carries the real constraint, and is
        // legal here only because of the `WebApplication` co-type.
        operatingSystem: 'All',
        browserRequirements: 'Requires JavaScript, WebAssembly and Web Workers',
        softwareRequirements: 'A browser with WebAssembly and Web Workers',
        license: MIT_LICENCE,
        datePublished: CONTENT_PUBLISHED,
        dateModified: CONTENT_UPDATED,
        isAccessibleForFree: true,
        // Stating a price of zero is what marks it free to a consumer that
        // reads offers rather than prose. Omitting the offer reads as
        // "price unknown".
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: site,
        },
        featureList: FEATURES.map((feature) => `${feature.label}: ${feature.text}`),
        image,
        // `screenshot` means a screenshot. It pointed at the share card,
        // which is a composed graphic and is already what `image` names.
        screenshot: SCREENSHOTS.map((shot) => ({
          '@type': 'ImageObject',
          url: `${SITE_URL}${shot.src}`,
          contentUrl: `${SITE_URL}${shot.src}`,
          caption: shot.caption,
        })),
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
        license: MIT_LICENCE,
        isPartOf: { '@id': `${SITE_URL}/#website` },
      },
      {
        // The same three steps the page shows under "How Paperweight works".
        // Google retired the HowTo rich result, so this earns nothing in a
        // search listing; it is here because a procedure stated as a
        // procedure is what an answer engine reproduces in order, rather than
        // paraphrasing into a shape that puts saving before editing.
        '@type': 'HowTo',
        '@id': `${SITE_URL}/#howto`,
        mainEntityOfPage: { '@id': `${SITE_URL}/#webpage` },
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
        mainEntityOfPage: { '@id': `${SITE_URL}/#webpage` },
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
