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
 * `Content-Signal` is Cloudflare's declaration format, and the signals only
 * mean anything alongside the text that defines them. This used to say that
 * Cloudflare prepends that preamble itself on a `workers.dev` host. It does
 * not: `curl` the deployed `robots.txt` and what comes back is byte-for-byte
 * what this file emits, so the site was publishing a directive with no
 * definition attached. `scripts/write-robots.mjs` now writes the file and
 * carries the preamble, because a metadata route cannot emit comments.
 *
 * `ai-train` is deliberately left unstated: under the signals' own terms that
 * neither grants nor refuses permission, which is an honest description of a
 * decision nobody has made yet.
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
