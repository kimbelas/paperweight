import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/site';

/**
 * Required by `output: 'export'`: a metadata route is a route handler, and the
 * export needs to be told there is nothing request-dependent in it to wait for.
 */
export const dynamic = 'force-static';

/**
 * `robots.txt`.
 *
 * Nothing is disallowed, including the crawlers that feed answer engines and
 * language models: being described accurately by one of those is the point of
 * the landing copy, and a tool nobody can find is not private, only unused.
 * `/_next/` in particular must stay crawlable — Googlebot renders the page,
 * and a blocked script bundle means it renders a blank one.
 *
 * `Content-Signal` is Cloudflare's declaration format, and this host already
 * serves the preamble that defines it: on a `workers.dev` subdomain Cloudflare
 * prepends its own commentary to whatever we ship, and cannot be turned off
 * there. That preamble carries no directives at all, so it blocks nothing —
 * but it does mean the vocabulary is already introduced by the time a crawler
 * reaches these lines. `ai-train` is deliberately left unstated: under the
 * preamble's own terms that neither grants nor refuses permission, which is an
 * honest description of a decision nobody has made yet.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        other: { 'Content-Signal': 'search=yes, ai-input=yes' },
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
