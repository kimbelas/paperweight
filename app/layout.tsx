import type { Metadata, Viewport } from 'next';
import { THEME_BOOT_SCRIPT } from '@/editor/theme';
import {
  AUTHOR,
  DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  TITLE,
  TITLE_TEMPLATE,
  VERIFICATION,
} from '@/site';
import './globals.css';

/**
 * The document head.
 *
 * `metadataBase` is what lets every URL below be written as a path: without
 * it, Next resolves `openGraph.images` and the canonical link against
 * localhost and says so at build time. The canonical matters more than usual
 * here, because pull-request previews are deployed from the same artefact as
 * production and would otherwise be a pile of duplicate sites.
 *
 * Absent on purpose: `icons`, `manifest` and `openGraph.images`. The files
 * beside this one — `icon.svg`, `apple-icon.png`, `manifest.ts`,
 * `opengraph-image.png` — are Next file conventions, and Next emits their
 * `<link>` and `<meta>` tags itself, with a content hash appended so a
 * changed image is not served from a cache. Writing them here as well would
 * produce two of each.
 */
/**
 * Only the tokens that exist. An empty `google-site-verification` is not a
 * neutral tag — it is a claim of ownership that fails — so the key is left
 * off the metadata entirely until there is something to put in it.
 */
const verification: Metadata['verification'] = {
  ...(VERIFICATION.google ? { google: VERIFICATION.google } : {}),
  ...(VERIFICATION.bing ? { other: { 'msvalidate.01': VERIFICATION.bing } } : {}),
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: TITLE_TEMPLATE },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [AUTHOR],
  creator: AUTHOR.name,
  publisher: AUTHOR.name,
  category: 'productivity',
  alternates: { canonical: '/' },
  ...(Object.keys(verification).length > 0 ? { verification } : {}),
  openGraph: {
    type: 'website',
    url: '/',
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    locale: 'en_GB',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  // A PDF full of reference numbers and dates should not have half of them
  // turned into telephone links by a mobile browser.
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Neither `maximumScale` nor `userScalable` appears here, and their absence
  // is the point: it is what lets the browser pinch-zoom the page.
  //
  // This carried `maximumScale: 1` on the reasoning that page zoom fights the
  // canvas's own zoom control. That was written when the editor was unusable
  // on a phone at all — two fixed rails left no document pane, so the only way
  // to see anything was the browser's zoom, and taking it away looked like
  // tidying up. The rails became drawers below 900px and the editor now works
  // at 360px, so the conflict it was avoiding no longer exists.
  //
  // What remained was a locked viewport, which is a WCAG 1.4.4 failure — text
  // has to reach 200% — and a Google mobile-friendly flag. The app's zoom
  // control scales the document; pinch scales the interface, including the
  // toolbar, the status bar and the type in the drawers. They are different
  // needs and only one of them is anybody's to withhold.
  //
  // The canvas keeps no `touch-action` of its own, so the gesture reaches the
  // browser. The one exception is the signature pad, which sets `touch-none`
  // because a finger there has to draw rather than pan; `tests/e2e/responsive`
  // asserts the document view sets nothing.
  //
  // One value, not a pair keyed on `prefers-color-scheme`: the app serves
  // light and switches to dark only when the toggle says so, so a theme colour
  // that followed the operating system would disagree with the page under it.
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Light is what the document is served as, so the page is correct before
    // any script runs and correct with scripting off. `suppressHydrationWarning`
    // is needed because the boot script below may have changed this attribute
    // by the time React hydrates, which is the whole point of it.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
