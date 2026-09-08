import type { Metadata, Viewport } from 'next';
import { THEME_BOOT_SCRIPT } from '@/editor/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Paperweight — local PDF editor',
  description:
    'Edit text, remove and add signatures, print and save. Runs entirely in your browser; documents never leave your device.',
  applicationName: 'Paperweight',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The editor is a fixed-layout workspace; letting it zoom fights the
  // canvas's own zoom control.
  maximumScale: 1,
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
