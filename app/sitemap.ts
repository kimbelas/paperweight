import type { MetadataRoute } from 'next';
import { CONTENT_UPDATED, SITE_URL } from '@/site';

/**
 * Required by `output: 'export'`: a metadata route is a route handler, and the
 * export needs to be told there is nothing request-dependent in it to wait for.
 */
export const dynamic = 'force-static';

/**
 * `sitemap.xml`.
 *
 * One page, which is the whole site. It is still worth shipping: a sitemap is
 * how the URL gets submitted to a search console, and it is where `lastmod`
 * lives.
 *
 * That date comes from `src/site.ts` and is bumped by hand, rather than from
 * `new Date()` at build time. A build-time date would claim the page had
 * changed on every deploy — including deploys that only touched the engine —
 * and a `lastmod` that is always today is a signal crawlers learn to discount.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(CONTENT_UPDATED),
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
