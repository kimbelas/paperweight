import type { MetadataRoute } from 'next';
import { DESCRIPTION, SITE_NAME } from '@/site';

/**
 * Required by `output: 'export'`: a metadata route is a route handler, and the
 * export needs to be told there is nothing request-dependent in it to wait for.
 */
export const dynamic = 'force-static';

/**
 * The web app manifest.
 *
 * It makes the app installable and gives a phone or desktop launcher a real
 * name and icon instead of a URL and a screenshot of the page. That is the
 * whole of what it does here: there is no service worker, so this is not yet
 * an app that works with no network on a cold start. Claiming otherwise is
 * the kind of half-shipped offline mode that leaves someone stranded in front
 * of a blank window, so the FAQ says plainly that it is not shipped.
 *
 * `theme_color` matches the toolbar rather than the page, because that is the
 * strip a mobile browser paints its own chrome against.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: `${SITE_NAME} — PDF editor`,
    short_name: SITE_NAME,
    description: DESCRIPTION,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'en',
    dir: 'ltr',
    background_color: '#f4f4f5',
    theme_color: '#ffffff',
    categories: ['productivity', 'utilities'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
