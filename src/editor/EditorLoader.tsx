'use client';

import dynamic from 'next/dynamic';
import { Landing } from './Landing';

/**
 * The editor, loaded in the browser only, behind a fallback that is the whole
 * landing page.
 *
 * The editor touches `window`, `Worker` and `canvas` on the way up, and the
 * PDF engine is a WebAssembly module, so there is nothing meaningful to render
 * for it on a server. `ssr: false` needs a client component to live in, which
 * is the only reason this file exists apart from `app/page.tsx` — the page
 * itself stays a server component so it can emit the structured data.
 *
 * The fallback is what `next build` writes into `out/index.html`, so it is
 * also the entire page as far as a crawler is concerned. It reproduces the
 * editor's chrome — a 52px header and the status bar's padding — so that when
 * the editor mounts and takes over, nothing moves.
 */
const Editor = dynamic(() => import('./Editor'), {
  ssr: false,
  loading: () => <LandingShell />,
});

export default function EditorLoader() {
  return <Editor />;
}

function LandingShell() {
  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--app-bg)' }}>
      <header
        className="flex shrink-0 items-center gap-2 px-3"
        style={{
          height: 52,
          background: 'var(--app-panel)',
          borderBottom: '1px solid var(--app-border)',
        }}
      >
        <span className="mr-1 text-sm font-semibold tracking-tight">Paperweight</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main
          className="relative min-w-0 flex-1 overflow-auto"
          // Must match what `Editor` uses with no document open, or the page
          // would change colour the moment the editor mounted.
          style={{ background: 'var(--app-bg)' }}
        >
          <Landing status="Starting the editor…" />
        </main>
      </div>

      <footer
        className="flex shrink-0 items-center gap-3 px-3 py-1.5 text-xs"
        style={{
          background: 'var(--app-panel)',
          borderTop: '1px solid var(--app-border)',
          color: 'var(--app-text-dim)',
        }}
      >
        <span>Starting the editor…</span>
      </footer>
    </div>
  );
}
